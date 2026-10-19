/** In-process reader/exclusive gate with cross-process reader and producer owner records. */
import { mkdir, opendir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { throwMinerU } from '../domain/errors.js'
import type { StoragePaths } from './paths.js'
import {
  createStorageOwnerId,
  storageOwnerState,
  type ProcessLock,
  type ProcessLockScope,
} from './process-lock.js'

export type StorageUseRole = 'reader' | 'producer'

export interface StorageAccessGateOptions {
  readonly paths: StoragePaths
  readonly lock: ProcessLock
}

export interface StorageUseRecord {
  readonly id: string
}

export type ClassifiedUseRecord =
  | { readonly kind: 'active'; readonly record: StorageUseRecord }
  | { readonly kind: 'dead'; readonly id: string; readonly record: StorageUseRecord }
  | { readonly kind: 'unknown'; readonly id: string }

const MAX_USERS = 1024

function errnoCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code
}

/** Classify unique owner directories. Foreign and unverifiable owners fail closed. */
export async function listUseRecords(paths: StoragePaths): Promise<readonly ClassifiedUseRecord[]> {
  const usersDir = paths.lockUsersDir()
  const records: ClassifiedUseRecord[] = []
  try {
    const directory = await opendir(usersDir)
    let count = 0
    for await (const entry of directory) {
      if (count++ >= MAX_USERS) {
        records.push({ kind: 'unknown', id: 'lease-scan-limit' })
        break
      }
      const id = entry.name
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        records.push({ kind: 'unknown', id })
        continue
      }
      const state = storageOwnerState(id)
      if (state === 'live') records.push({ kind: 'active', record: { id } })
      else if (state === 'dead') records.push({ kind: 'dead', id, record: { id } })
      else records.push({ kind: 'unknown', id })
    }
  } catch (error) {
    if (errnoCode(error) !== 'ENOENT') throw error
  }
  return records
}

export class StorageAccessGate {
  private activeReaders = 0
  private exclusive = false
  private readonly paths: StoragePaths
  private readonly lock: ProcessLock

  constructor(options: StorageAccessGateOptions) {
    this.paths = options.paths
    this.lock = options.lock
  }

  get activeReaderCount(): number { return this.activeReaders }

  /** Covers the actual reader or producer I/O lifetime. */
  async runShared<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted()
    if (this.exclusive) throwMinerU('STORAGE_LOCKED', 'MinerU storage maintenance is in progress')
    this.activeReaders++
    let ownerId: string | undefined
    try {
      await this.lock.initialize(signal)
      ownerId = await this.lock.withLock(async scope => {
        this.lock.assertScope(scope)
        if (this.exclusive) throwMinerU('STORAGE_LOCKED', 'MinerU storage maintenance is in progress')
        const id = createStorageOwnerId('u')
        await mkdir(join(this.paths.lockUsersDir(), id), { mode: 0o700 })
        return id
      }, signal)
      signal?.throwIfAborted()
      // Never race operation against signal: the record covers actual I/O lifetime.
      return await operation()
    } finally {
      try {
        // This unique directory can only belong to this invocation. Direct
        // removal cannot admit maintenance early because the operation is done.
        if (ownerId !== undefined) {
          await rm(join(this.paths.lockUsersDir(), ownerId), { recursive: true, force: true })
        }
      } finally {
        this.activeReaders--
      }
    }
  }

  /** Fail fast, then recheck and prune confirmed-dead records under the scoped mutex. */
  async runMaintenance<T>(operation: (scope: ProcessLockScope) => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted()
    if (this.exclusive || this.activeReaders > 0) {
      throwMinerU('STORAGE_LOCKED', 'MinerU storage is in use by an active reader or producer')
    }
    await this.lock.initialize(signal)
    await this.assertNoActiveRecords(false)

    return await this.lock.withLock(async scope => {
      this.lock.assertScope(scope)
      if (this.exclusive || this.activeReaders > 0) {
        throwMinerU('STORAGE_LOCKED', 'MinerU storage is in use by an active reader or producer')
      }
      await this.assertNoActiveRecords(true, scope)
      this.exclusive = true
      try {
        return await operation(scope)
      } finally {
        this.exclusive = false
      }
    }, signal)
  }

  private async assertNoActiveRecords(pruneDead: boolean, scope?: ProcessLockScope): Promise<void> {
    const records = await listUseRecords(this.paths)
    if (pruneDead) {
      if (scope === undefined) throw new TypeError('Use-record pruning requires a process lock scope')
      this.lock.assertScope(scope)
      for (const record of records) {
        if (record.kind === 'dead' && storageOwnerState(record.id) === 'dead') {
          await rm(join(this.paths.lockUsersDir(), record.id), { recursive: true, force: true })
        }
      }
    }
    const remaining = pruneDead ? await listUseRecords(this.paths) : records
    if (remaining.some(record => record.kind !== 'dead')) {
      throwMinerU('STORAGE_LOCKED', 'MinerU storage is in use or its owner cannot be safely verified')
    }
  }
}
