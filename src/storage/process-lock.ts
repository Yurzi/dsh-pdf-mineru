/**
 * process-lock.ts — Fail-closed single-process storageRoot lock.
 *
 * Prevents multiple concurrent DSH processes from mutating the same storageRoot.
 * Linux uses an abstract Unix socket. Windows uses a named pipe to serialize
 * metadata acquisition/recovery; both IPC endpoints disappear on process death.
 * Windows also honors the file lock used by older plugin versions: only a
 * valid same-host record with a definitively dead PID may be reclaimed.
 */

import { createHash, randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:net'
import { chmod, link, lstat, mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { throwMinerU } from '../domain/errors.js'
import type { StoragePaths } from './paths.js'

export interface ProcessLockPayload {
  readonly pid: number
  readonly ownerToken: string
  readonly createdAt: number
  readonly hostname: string
}

function parseLockPayload(raw: string): ProcessLockPayload {
  const value: unknown = JSON.parse(raw)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('lock payload is not an object')
  const record = value as Record<string, unknown>
  if (!Number.isSafeInteger(record.pid) || (record.pid as number) <= 0
    || typeof record.ownerToken !== 'string' || record.ownerToken.length === 0
    || !Number.isSafeInteger(record.createdAt) || (record.createdAt as number) < 0
    || typeof record.hostname !== 'string' || record.hostname.length === 0) {
    throw new TypeError('lock payload is invalid')
  }
  return {
    pid: record.pid as number,
    ownerToken: record.ownerToken,
    createdAt: record.createdAt as number,
    hostname: record.hostname,
  }
}

export class ProcessLock {
  private readonly lockFilePath: string
  private readonly socketName: string
  private readonly ownerToken: string
  private server: Server | undefined
  private acquired = false

  constructor(public readonly paths: StoragePaths) {
    this.lockFilePath = paths.processLockFile()
    const rootHash = createHash('sha256').update(paths.root).digest('hex').slice(0, 32)
    this.socketName = `\0dsh-pdf-mineru-${rootHash}`
    this.ownerToken = `owner_${randomUUID().replace(/-/g, '')}`
  }

  isHeld(): boolean {
    return this.acquired
  }

  async acquire(signal?: AbortSignal): Promise<void> {
    if (this.acquired) return
    signal?.throwIfAborted()

    await mkdir(this.paths.root, { recursive: true, mode: 0o700 })
    await chmod(this.paths.root, 0o700)
    signal?.throwIfAborted()
    const payload: ProcessLockPayload = {
      pid: process.pid,
      ownerToken: this.ownerToken,
      createdAt: Date.now(),
      hostname: hostname(),
    }

    if (process.platform !== 'linux' && process.platform !== 'win32') {
      let createdMetadata = false
      try {
        await writeFile(this.lockFilePath, JSON.stringify(payload, null, 2), { flag: 'wx', mode: 0o600 })
        createdMetadata = true
        signal?.throwIfAborted()
        this.acquired = true
        return
      } catch (error) {
        if (createdMetadata) await unlink(this.lockFilePath).catch(() => undefined)
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throwMinerU('STORAGE_LOCKED', 'MinerU storage is already locked by another process')
        }
        throw error
      }
    }

    // Canonicalize Windows aliases/casing so one physical root has one gate.
    // Keep the Linux endpoint unchanged for compatibility with running versions.
    const socketName = process.platform === 'win32'
      ? `\\\\.\\pipe\\dsh-pdf-mineru-${createHash('sha256').update((await realpath(this.paths.root)).toLowerCase()).digest('hex').slice(0, 32)}`
      : this.socketName
    const server = createServer(socket => socket.destroy())
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => { server.removeListener('listening', onListening); reject(error) }
        const onListening = (): void => { server.removeListener('error', onError); resolve() }
        server.once('error', onError)
        server.once('listening', onListening)
        server.listen(socketName)
      })
      signal?.throwIfAborted()
    } catch (error) {
      await new Promise<void>(resolve => server.close(() => resolve()))
      if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        throwMinerU('STORAGE_LOCKED', 'MinerU storage is already locked by another process')
      }
      throw error
    }
    server.unref()
    this.server = server
    try {
      if (process.platform === 'win32') {
        await this.acquireWindowsMetadata(payload, signal)
      } else {
        await writeFile(this.lockFilePath, JSON.stringify(payload, null, 2), { flag: 'w', mode: 0o600 })
      }
      await chmod(this.lockFilePath, 0o600)
      signal?.throwIfAborted()
      this.acquired = true
    } catch (error) {
      this.server = undefined
      // Never remove a legacy/live owner's metadata when acquisition failed.
      await this.removeOwnedMetadata()
      await new Promise<void>(resolve => server.close(() => resolve()))
      throw error
    }
  }

  private async acquireWindowsMetadata(payload: ProcessLockPayload, signal?: AbortSignal): Promise<void> {
    const temporary = `${this.lockFilePath}.${this.ownerToken}.tmp`
    // Publish a complete record atomically without overwriting an existing lock.
    // A crash before publication leaves only a harmless, uniquely named temp file.
    await writeFile(temporary, JSON.stringify(payload, null, 2), { flag: 'wx', mode: 0o600 })
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        signal?.throwIfAborted()
        try {
          await link(temporary, this.lockFilePath)
          return
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
          if (attempt !== 0) throwMinerU('STORAGE_LOCKED', 'MinerU storage lock changed during recovery; retry startup')
        }
        await this.reclaimDeadWindowsMetadata()
      }
    } finally {
      await unlink(temporary).catch(() => undefined)
    }
  }

  private async reclaimDeadWindowsMetadata(): Promise<void> {
    try {
      const before = await lstat(this.lockFilePath)
      if (!before.isFile() || before.isSymbolicLink()) throw new Error('not a regular lock file')
      const raw = await readFile(this.lockFilePath, 'utf8')
      const existing = parseLockPayload(raw)
      if (existing.hostname.toLowerCase() !== hostname().toLowerCase()) throw new Error('foreign lock owner')
      try {
        process.kill(existing.pid, 0)
        throw new Error('lock owner is alive')
      } catch (error) {
        // EPERM, PID reuse, and all ambiguous states must remain fail-closed.
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
      }
      const after = await lstat(this.lockFilePath)
      if (!after.isFile() || after.isSymbolicLink()
        || before.dev !== after.dev || before.ino !== after.ino
        || before.mtimeMs !== after.mtimeMs
        || await readFile(this.lockFilePath, 'utf8') !== raw) throw new Error('lock changed')
      // New versions are serialized by the pipe. A legacy contender can only
      // win after this unlink, and the subsequent exclusive link will detect it.
      await unlink(this.lockFilePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throwMinerU('STORAGE_LOCKED', 'MinerU storage lock is active or cannot be safely recovered; verify its owner before manual recovery')
    }
  }

  private async removeOwnedMetadata(): Promise<void> {
    try {
      const existing = parseLockPayload(await readFile(this.lockFilePath, 'utf8'))
      if (existing.ownerToken === this.ownerToken && existing.pid === process.pid) {
        await unlink(this.lockFilePath)
      }
    } catch {
      // Ignore if already unlinked or inaccessible; never remove unknown data.
    }
  }

  async release(): Promise<void> {
    if (!this.acquired) return
    this.acquired = false
    const server = this.server
    this.server = undefined
    // Remove metadata before relinquishing IPC authority. Otherwise a new owner
    // could publish its record between our ownership check and unlink.
    try {
      await this.removeOwnedMetadata()
    } finally {
      if (server !== undefined) {
        await new Promise<void>(resolve => server.close(() => resolve()))
      }
    }
  }
}
