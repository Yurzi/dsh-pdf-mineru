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
  const usersDir = join(paths.root, '.lock', 'users')
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
  private readonly paths: StoragePaths | undefined
  private readonly lock: ProcessLock | undefined

  constructor(options?: StorageAccessGateOptions) {
    this.paths = options?.paths
    this.lock = options?.lock
  }

  get activeReaderCount(): number { return this.activeReaders }

  async runShared<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return await this.runUse(operation, signal)
  }

  /** Producer leases use the same owner protocol and cover the full producer lifetime. */
  async runProducer<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return await this.runUse(operation, signal)
  }

  private async runUse<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted()
    if (this.exclusive) throwMinerU('STORAGE_LOCKED', 'MinerU storage maintenance is in progress')
    this.activeReaders++
    let ownerId: string | undefined
    try {
      if (this.paths !== undefined && this.lock !== undefined) {
        await this.lock.initialize(signal)
        ownerId = await this.lock.withLock(async scope => {
          this.lock!.assertScope(scope)
          if (this.exclusive) throwMinerU('STORAGE_LOCKED', 'MinerU storage maintenance is in progress')
          const id = createStorageOwnerId('u')
          await mkdir(join(this.paths!.root, '.lock', 'users', id), { mode: 0o700 })
          return id
        }, signal)
      }
      signal?.throwIfAborted()
      // Never race operation against signal: the record covers actual I/O lifetime.
      return await operation()
    } finally {
      try {
        // This unique directory can only belong to this invocation. Direct
        // removal cannot admit maintenance early because the operation is done.
        if (ownerId !== undefined && this.paths !== undefined) {
          await rm(join(this.paths.root, '.lock', 'users', ownerId), { recursive: true, force: true })
        }
      } finally {
        this.activeReaders--
      }
    }
  }

  /** Fail fast, then recheck and prune confirmed-dead records under the scoped mutex. */
  async runMaintenance<T>(operation: (scope: ProcessLockScope) => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted()
    if (this.lock === undefined || this.paths === undefined) {
      throw new TypeError('Cross-process storage maintenance requires { paths, lock }')
    }
    if (this.exclusive || this.activeReaders > 0) {
      throwMinerU('STORAGE_LOCKED', 'MinerU storage is in use by an active reader or producer')
    }
    await this.lock.initialize(signal)
    await this.assertNoActiveRecords(false)

    return await this.lock.withLock(async scope => {
      this.lock!.assertScope(scope)
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

  /** Local-only compatibility API. Destructive cross-process work uses runMaintenance. */
  tryAcquireExclusive(): (() => void) | undefined {
    if (this.exclusive || this.activeReaders > 0) return undefined
    this.exclusive = true
    let released = false
    return () => {
      if (released) return
      released = true
      this.exclusive = false
    }
  }

  private async assertNoActiveRecords(pruneDead: boolean, scope?: ProcessLockScope): Promise<void> {
    const records = await listUseRecords(this.paths!)
    if (pruneDead) {
      if (scope === undefined) throw new TypeError('Use-record pruning requires a process lock scope')
      this.lock!.assertScope(scope)
      for (const record of records) {
        if (record.kind === 'dead' && storageOwnerState(record.id) === 'dead') {
          await rm(join(this.paths!.root, '.lock', 'users', record.id), { recursive: true, force: true })
        }
      }
    }
    const remaining = pruneDead ? await listUseRecords(this.paths!) : records
    if (remaining.some(record => record.kind !== 'dead')) {
      throwMinerU('STORAGE_LOCKED', 'MinerU storage is in use or its owner cannot be safely verified')
    }
  }
}
