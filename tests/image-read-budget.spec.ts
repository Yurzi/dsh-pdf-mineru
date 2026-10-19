import { beforeEach, describe, expect, it, vi } from 'vitest'
import { imageCandidate, resultView } from './support/views.js'

const MiB = 1024 * 1024
const fault = vi.hoisted(() => ({ mode: 'partial', bytes: 0, closes: 0 }))

// Only image-handle I/O is faulted. The real bounded reader and all other fs exports remain intact.
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, open: async (...args: Parameters<typeof actual.open>) => {
    if (!String(args[0]).startsWith('/virtual-budget/')) return actual.open(...args)
    let reads = 0
    let stats = 0
    return {
      stat: async () => {
        if (++stats > 1 && fault.mode === 'stat') throw new Error('injected final stat failure')
        return { isFile: () => true, size: 8 * 1024 * 1024 }
      },
      read: async () => {
        if (++reads > 1) throw new Error('injected partial read failure')
        const bytesRead = (fault.mode === 'partial' ? 7 : 8) * 1024 * 1024
        fault.bytes += bytesRead
        return { bytesRead }
      },
      close: async () => {
        fault.closes++
        if (fault.mode === 'close') throw new Error('injected close failure')
      },
    }
  } }
})

import { inlineImages } from '../src/reader/visuals.js'

describe('actual image read accounting across I/O failure', () => {
  beforeEach(() => { Object.assign(fault, { bytes: 0, closes: 0 }) })

  it.each([
    { mode: 'partial', consumedMiB: 21 },
    { mode: 'stat', consumedMiB: 24 },
    { mode: 'close', consumedMiB: 24 },
  ])('charges consumed bytes against the response budget when $mode fails', async ({ mode, consumedMiB }) => {
    fault.mode = mode
    const saveImage = vi.fn()
    const view = resultView({
      markdown_content: 'Figures', output_limit_chars: 200_000,
      ordered_images: Array.from({ length: 6 }, (_, index) => imageCandidate({ path: '/virtual-budget/' + String(index) + '.png', name: String(index) + '.png', bytes: 8 * MiB })),
    })
    const result = await inlineImages(view, saveImage, 6, new AbortController().signal)
    expect(saveImage).not.toHaveBeenCalled()
    expect(result.inlined_images).toBeUndefined()
    // Failed reads still consume the total image budget; once it is spent no further bytes are read.
    expect(fault.bytes).toBe(consumedMiB * MiB)
    // Every opened handle is closed, even when reads fail.
    expect(fault.closes).toBe(6)
    if (mode !== 'close') {
      expect(result.ordered_images!.map(image => image.status)).toEqual(['failed', 'failed', 'failed', 'omitted', 'omitted', 'omitted'])
    }
  })
})
