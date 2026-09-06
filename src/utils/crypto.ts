import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

/** Stream a file into SHA-256; Node owns cancellation listener cleanup. */
export async function computeFileSha256(filePath: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted()
  const digest = createHash('sha256')
  const stream = createReadStream(filePath, { signal })
  try {
    for await (const chunk of stream) digest.update(chunk as Buffer)
    signal?.throwIfAborted()
    return digest.digest('hex')
  } catch (error) {
    // Preserve the caller's domain cancellation reason rather than Node's wrapper.
    signal?.throwIfAborted()
    throw error
  } finally {
    stream.destroy()
  }
}
