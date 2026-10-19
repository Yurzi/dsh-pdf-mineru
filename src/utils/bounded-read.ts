import { constants } from 'node:fs'
import type { BigIntStats } from 'node:fs'
import { open } from 'node:fs/promises'

export type BoundedReadFailure = 'not-file' | 'too-large' | 'size-mismatch' | 'short-read' | 'changed' | 'io'

/** Callers map the failure stage to their own domain error; bytesRead supports budget accounting. */
export class BoundedReadError extends Error {
  constructor(readonly reason: BoundedReadFailure, readonly bytesRead: number, options?: ErrorOptions) {
    super('bounded file read failed: ' + reason, options)
    this.name = 'BoundedReadError'
  }
}

export interface BoundedReadLimits {
  /** Files larger than this are rejected before any byte is read. */
  readonly maxBytes: number
  /** Size declared by a manifest; the opened file must match it exactly. */
  readonly expectedBytes?: number
}

function sameVersion(left: BigIntStats, right: BigIntStats): boolean {
  return right.isFile() && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs
}

/**
 * Read one regular file through a no-follow descriptor. The size is fixed by fstat
 * before reading, and the descriptor must be unchanged after the last byte.
 * Open failures and cancellation propagate unchanged.
 */
export async function readFileBounded(path: string, limits: BoundedReadLimits, signal?: AbortSignal): Promise<Buffer> {
  signal?.throwIfAborted()
  if (limits.expectedBytes !== undefined && limits.expectedBytes > limits.maxBytes) throw new BoundedReadError('too-large', 0)
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  let bytesRead = 0
  let result: Buffer | undefined
  let failure: unknown
  try {
    const before = await handle.stat({ bigint: true })
    const size = Number(before.size)
    if (!before.isFile()) throw new BoundedReadError('not-file', 0)
    if (size > limits.maxBytes) throw new BoundedReadError('too-large', 0)
    if (limits.expectedBytes !== undefined && size !== limits.expectedBytes) throw new BoundedReadError('size-mismatch', 0)
    const buffer = Buffer.alloc(size)
    while (bytesRead < size) {
      signal?.throwIfAborted()
      let read
      try {
        read = await handle.read(buffer, bytesRead, size - bytesRead, bytesRead)
      } catch (error) {
        throw new BoundedReadError('io', bytesRead, { cause: error })
      }
      bytesRead += read.bytesRead
      if (read.bytesRead === 0) throw new BoundedReadError('short-read', bytesRead)
    }
    signal?.throwIfAborted()
    let after
    try {
      after = await handle.stat({ bigint: true })
    } catch (error) {
      throw new BoundedReadError('io', bytesRead, { cause: error })
    }
    if (!sameVersion(before, after)) throw new BoundedReadError('changed', bytesRead)
    result = buffer
  } catch (error) {
    failure = error
  }
  try {
    await handle.close()
  } catch (error) {
    throw new BoundedReadError('io', bytesRead, { cause: error })
  }
  if (result === undefined) throw failure
  return result
}
