import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from 'cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { MinerUService, ResultView } from '../src/service/mineru-service.js'

const fault = vi.hoisted(() => ({ mode: 'partial', bytes: 0, reads: 0, closes: 0 }))

// Only image-handle I/O is faulted. The real tool/schema and all other fs exports remain intact.
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
        fault.reads++
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

import { registerTools } from '../src/tools.js'

describe('actual image read accounting across I/O failure', () => {
  beforeEach(() => { Object.assign(fault, { bytes: 0, reads: 0, closes: 0 }) })

  it.each(['partial', 'stat', 'close'])('charges consumed bytes when %s fails', async mode => {
    fault.mode = mode
    const saveImage = vi.fn()
    let readTool: any
    const ctx = {
      tools: { register: (tool: any) => { if (tool.name === 'read_pdf') readTool = tool; return () => undefined } },
      get: (name: string) => name === 'attachments' ? { saveImage }
        : name === 'llm' ? { resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }) } : undefined,
    } as unknown as Context
    const view: ResultView = {
      state: 'completed', source: 'cache', cache_hit: true, result_id: 'mr_fixture',
      content_status: 'complete', markdown_content: 'Figures', output_limit_chars: 200000,
      manifest_path: '/virtual-budget/manifest.json',
      files: [{ file_id: 'mf_fixture', name: 'document.pdf', artifacts: [] }],
      ordered_images: Array.from({ length: 6 }, (_, i) => ({
        path: '/virtual-budget/' + i + '.png', name: i + '.png', media_type: 'image/png', bytes: 8 * 1024 * 1024,
      })),
    }
    const dispose = registerTools(ctx, () => ({ parseDocument: async () => view }) as unknown as MinerUService)
    const exec = {
      callId: 'fault', name: 'read_pdf', arguments: {}, signal: new AbortController().signal,
      agent: { options: { provider: 'fixture', model: 'vision' }, session: { header: { id: 'session_fixture' } } },
    } as unknown as ToolRunContext
    try {
      const result = await readTool.execute({ file_path: '/source.pdf' }, exec)
      expect(saveImage).not.toHaveBeenCalled()
      expect(result.inlined_images).toBeUndefined()
      expect(fault.bytes).toBe((mode === 'partial' ? 21 : 24) * 1024 * 1024)
      expect(fault.bytes).toBeLessThanOrEqual(24 * 1024 * 1024)
      expect(fault.reads).toBe(mode === 'partial' ? 6 : 3)
      expect(fault.closes).toBe(6)
      if (mode !== 'close') {
        expect(result.ordered_images.map((image: { status: string }) => image.status))
          .toEqual(['failed', 'failed', 'failed', 'omitted', 'omitted', 'omitted'])
      }
    } finally { await dispose() }
  })
})
