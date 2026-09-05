import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

/**
 * Computes the SHA-256 hexadecimal digest of a local file via streaming.
 * Respects an optional AbortSignal and cleans up listeners and streams.
 */
export async function computeFileSha256(filePath: string, signal?: AbortSignal): Promise<string> {
  const digest = createHash('sha256')
  const stream = createReadStream(filePath)
  const onAbort = (): void => {
    stream.destroy(signal?.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'))
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    signal?.throwIfAborted()
    for await (const chunk of stream) {
      signal?.throwIfAborted()
      digest.update(chunk as Buffer)
    }
    return digest.digest('hex')
  } finally {
    signal?.removeEventListener('abort', onAbort)
    stream.destroy()
  }
}
