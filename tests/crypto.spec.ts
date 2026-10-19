import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { computeFileSha256 } from '../src/utils/crypto.js'
import { tempRoot } from './support/storage-fixtures.js'

async function file(contents: string | Buffer): Promise<string> {
  const path = join(await tempRoot('mineru-crypto-'), 'sample.bin')
  await writeFile(path, contents)
  return path
}

describe('computeFileSha256', () => {
  it.each(['Hello, world! Testing stream hashing.', ''])('hashes %j as a stream', async contents => {
    expect(await computeFileSha256(await file(contents))).toBe(createHash('sha256').update(contents).digest('hex'))
  })

  it('preserves the cancellation reason after a stream has been opened', async () => {
    const path = await file(Buffer.alloc(1024 * 1024, 42))
    const controller = new AbortController()
    const reason = new Error('Hash caller cancelled')
    const pending = computeFileSha256(path, controller.signal)
    controller.abort(reason)
    await expect(pending).rejects.toBe(reason)
  })

  it('rejects an already-aborted signal before hashing', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('User cancelled', 'AbortError'))
    await expect(computeFileSha256(await file('sample'), controller.signal)).rejects.toThrow(/User cancelled/)
  })
})
