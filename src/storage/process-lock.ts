/**
 * process-lock.ts — Fail-closed single-process storageRoot lock.
 *
 * Prevents multiple concurrent DSH processes from mutating the same storageRoot.
 * Uses a cross-platform atomic file lock on this.lockFilePath with dead PID reclamation.
 */

import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { hostname } from 'node:os'
import { throwMinerU } from '../domain/errors.js'
import type { StoragePaths } from './paths.js'

export interface ProcessLockPayload {
  readonly pid: number
  readonly ownerToken: string
  readonly createdAt: number
  readonly hostname: string
}

function parseLockPayload(raw: string): ProcessLockPayload | null {
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
    const record = value as Record<string, unknown>
    if (
      !Number.isSafeInteger(record.pid) || (record.pid as number) <= 0
      || typeof record.ownerToken !== 'string' || record.ownerToken.length === 0
      || !Number.isSafeInteger(record.createdAt) || (record.createdAt as number) < 0
      || typeof record.hostname !== 'string' || record.hostname.length === 0
    ) {
      return null
    }
    return {
      pid: record.pid as number,
      ownerToken: record.ownerToken,
      createdAt: record.createdAt as number,
      hostname: record.hostname,
    }
  } catch {
    return null
  }
}

export class ProcessLock {
  private readonly lockFilePath: string
  private readonly ownerToken: string
  private acquired = false

  constructor(public readonly paths: StoragePaths) {
    this.lockFilePath = paths.processLockFile()
    this.ownerToken = `owner_${randomUUID().replace(/-/g, '')}`
  }

  isHeld(): boolean {
    return this.acquired
  }

  /**
   * Executes a critical section with exclusive scoped lock authority,
   * acquiring the lock on entry and automatically releasing it on exit.
   */
  async withLock<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const wasHeld = this.acquired
    if (!wasHeld) {
      await this.acquire(signal)
    }
    try {
      return await operation()
    } finally {
      if (!wasHeld) {
        await this.release()
      }
    }
  }

  async acquire(signal?: AbortSignal): Promise<void> {
    if (this.acquired) return
    signal?.throwIfAborted()

    await mkdir(this.paths.root, { recursive: true, mode: 0o700 })
    await chmod(this.paths.root, 0o700).catch(() => undefined)
    signal?.throwIfAborted()

    const payload: ProcessLockPayload = {
      pid: process.pid,
      ownerToken: this.ownerToken,
      createdAt: Date.now(),
      hostname: hostname(),
    }
    const serialized = JSON.stringify(payload, null, 2)

    for (let attempt = 0; attempt < 3; attempt++) {
      signal?.throwIfAborted()
      try {
        await writeFile(this.lockFilePath, serialized, { flag: 'wx', mode: 0o600 })
        await chmod(this.lockFilePath, 0o600).catch(() => undefined)
        if (signal?.aborted) {
          await unlink(this.lockFilePath).catch(() => undefined)
          signal.throwIfAborted()
        }
        this.acquired = true
        return
      } catch (error) {
        signal?.throwIfAborted()
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw error
        }

        // Lock file exists — inspect payload
        let raw: string
        try {
          raw = await readFile(this.lockFilePath, 'utf8')
        } catch (readError) {
          if ((readError as NodeJS.ErrnoException).code === 'ENOENT') {
            // Lock was unlinked concurrently, retry acquire
            continue
          }
          throwMinerU('STORAGE_LOCKED', 'MinerU storage lock could not be read')
        }

        const existing = parseLockPayload(raw)
        if (!existing) {
          throwMinerU('STORAGE_LOCKED', 'MinerU storage lock metadata is invalid or ambiguous')
        }

        if (existing.pid === process.pid && existing.ownerToken === this.ownerToken) {
          this.acquired = true
          return
        }

        if (existing.hostname.toLowerCase() !== hostname().toLowerCase()) {
          throwMinerU('STORAGE_LOCKED', 'MinerU storage is locked by another host')
        }

        try {
          process.kill(existing.pid, 0)
          // Owner PID is alive: if attempts remain, wait briefly for short scoped operation to finish
          if (attempt < 2) {
            await sleep(25, undefined, { signal }).catch(() => undefined)
            continue
          }
          throwMinerU('STORAGE_LOCKED', 'MinerU storage is already locked by an active process')
        } catch (killError) {
          if ((killError as any)?.failure?.code === 'STORAGE_LOCKED') {
            throw killError
          }
          if ((killError as NodeJS.ErrnoException).code === 'ESRCH') {
            // Owner is dead: safely unlink the stale lock file and retry acquire
            try {
              await unlink(this.lockFilePath)
            } catch (unlinkError) {
              if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') {
                throwMinerU('STORAGE_LOCKED', 'MinerU stale storage lock could not be removed')
              }
            }
            continue
          }
          // Owner is alive or ambiguous (EPERM, etc.)
          throwMinerU('STORAGE_LOCKED', 'MinerU storage lock owner is active or cannot be safely verified')
        }
      }
    }

    throwMinerU('STORAGE_LOCKED', 'MinerU storage lock contention; retry startup')
  }

  async release(): Promise<void> {
    if (!this.acquired) return
    this.acquired = false
    try {
      const raw = await readFile(this.lockFilePath, 'utf8')
      const existing = parseLockPayload(raw)
      if (existing && existing.ownerToken === this.ownerToken && existing.pid === process.pid) {
        await unlink(this.lockFilePath).catch(() => undefined)
      }
    } catch {
      // Ignore errors on release
    }
  }
}
