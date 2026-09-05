import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { computeFileSha256 } from '../src/utils/crypto.js'

describe('computeFileSha256', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mineru-crypto-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('computes correct sha256 for a file', async () => {
    const filePath = join(tempDir, 'sample.txt')
    const sampleText = 'Hello, world! Testing computeFileSha256 stream hashing.'
    await writeFile(filePath, sampleText, 'utf8')

    const expectedHash = createHash('sha256').update(sampleText).digest('hex')
    const result = await computeFileSha256(filePath)
    expect(result).toBe(expectedHash)
  })

  it('computes correct sha256 for an empty file', async () => {
    const filePath = join(tempDir, 'empty.txt')
    await writeFile(filePath, '', 'utf8')

    const expectedHash = createHash('sha256').update('').digest('hex')
    const result = await computeFileSha256(filePath)
    expect(result).toBe(expectedHash)
  })

  it('respects abort signal before hashing', async () => {
    const filePath = join(tempDir, 'abort.txt')
    await writeFile(filePath, 'sample content', 'utf8')

    const controller = new AbortController()
    controller.abort(new DOMException('User cancelled', 'AbortError'))

    await expect(computeFileSha256(filePath, controller.signal)).rejects.toThrowError(/User cancelled/i)
  })
})
