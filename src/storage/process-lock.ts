/**
 * process-lock.ts — Single-process storageRoot lock with stale PID cleanup.
 *
 * Prevents multiple concurrent DSH processes from mutating the same storageRoot.
 * Dead process locks (ESRCH) are safely reclaimed; active locks throw STORAGE_LOCKED.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
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

function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException
    if (nodeErr.code === 'ESRCH') return false
    if (nodeErr.code === 'EPERM') return true
    return false
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

  async acquire(signal?: AbortSignal): Promise<void> {
    if (this.acquired) return
    signal?.throwIfAborted()

    await mkdir(this.paths.root, { recursive: true })

    const payload: ProcessLockPayload = {
      pid: process.pid,
      ownerToken: this.ownerToken,
      createdAt: Date.now(),
      hostname: hostname(),
    }
    const data = JSON.stringify(payload, null, 2)

    for (let attempt = 0; attempt < 3; attempt++) {
      signal?.throwIfAborted()
      try {
        await writeFile(this.lockFilePath, data, { flag: 'wx', mode: 0o600 })
        this.acquired = true
        return
      } catch (err: unknown) {
        const nodeErr = err as NodeJS.ErrnoException
        if (nodeErr.code !== 'EEXIST') {
          throw err
        }

        // Lock file exists — check if existing lock is active or stale
        let existing: ProcessLockPayload
        try {
          existing = parseLockPayload(await readFile(this.lockFilePath, 'utf8'))
        } catch {
          throwMinerU(
            'STORAGE_LOCKED',
            `MinerU storage root "${this.paths.root}" has an invalid lock file; refusing unsafe recovery`,
          )
        }

        if (isProcessAlive(existing.pid)) {
          if (existing.pid === process.pid && existing.ownerToken === this.ownerToken) {
            this.acquired = true
            return
          }
          throwMinerU(
            'STORAGE_LOCKED',
            `MinerU storage root "${this.paths.root}" is locked by active process PID ${String(existing.pid)} (host: ${existing.hostname})`,
          )
        }

        // A well-formed lock whose owner is definitely dead may be reclaimed.
        try {
          await unlink(this.lockFilePath)
        } catch (unlinkErr: unknown) {
          const uErr = unlinkErr as NodeJS.ErrnoException
          if (uErr.code !== 'ENOENT') throw unlinkErr
        }
      }
    }

    // Final attempt if loop exhausted
    try {
      await writeFile(this.lockFilePath, data, { flag: 'wx' })
      this.acquired = true
    } catch (finalErr: unknown) {
      const nodeErr = finalErr as NodeJS.ErrnoException
      if (nodeErr.code === 'EEXIST') {
        throwMinerU('STORAGE_LOCKED', `Failed to acquire lock on "${this.paths.root}"`)
      }
      throw finalErr
    }
  }

  async release(): Promise<void> {
    if (!this.acquired) return
    this.acquired = false

    try {
      const raw = await readFile(this.lockFilePath, 'utf8')
      const existing = parseLockPayload(raw)
      if (existing.ownerToken === this.ownerToken && existing.pid === process.pid) {
        await unlink(this.lockFilePath)
      }
    } catch {
      // Ignore if already unlinked or inaccessible
    }
  }
}
