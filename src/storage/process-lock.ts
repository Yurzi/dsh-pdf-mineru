/**
 * Scoped local-filesystem Lamport bakery mutex. Requires one host/PID namespace
 * and coherent local directory operations (not NFS/distributed locking).
 * Each attempt owns a never-reused directory. Reclamation can delete only a
 * confirmed-dead owner's unique directory, never a shared/reused lock pathname.
 */
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, opendir, rename, rm, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { dirname, join, parse, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { MinerUError, failure } from '../domain/errors.js'
import type { StoragePaths } from './paths.js'

export interface ProcessLockPayload {
  readonly pid: number
  readonly ownerToken: string
  readonly createdAt: number
  readonly hostname: string
}
export interface ProcessLockOptions {
  readonly acquireTimeoutMs?: number
  readonly pollIntervalMs?: number
}
const scopeBrand = Symbol('MinerU mutation scope')
export interface ProcessLockScope { readonly [scopeBrand]: true }
const HOST = createHash('sha256').update(hostname().toLowerCase()).digest('hex')
const OWNER_ID = /^([cu])_([0-9a-f]{64})_([1-9][0-9]{0,9})_([0-9a-f]{32})$/
const MAX_CLAIMS = 256
// A persistent *foreign-host* payload also fences old v1 implementations out.
const FENCE: ProcessLockPayload = Object.freeze({
  pid: 1, ownerToken: 'mineru-lock-protocol-v2', createdAt: 0,
  hostname: 'mineru-lock-protocol-v2:' + HOST,
})

export function createStorageOwnerId(prefix: 'c' | 'u', pid = process.pid): string {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid > 2_147_483_647) throw new TypeError('Invalid storage owner PID')
  return `${prefix}_${HOST}_${pid}_${randomUUID().replaceAll('-', '')}`
}
export function storageOwnerState(id: string): 'live' | 'dead' | 'foreign' | 'unknown' {
  const match = OWNER_ID.exec(id)
  if (match === null) return 'unknown'
  if (match[2] !== HOST) return 'foreign'
  const pid = Number(match[3])
  if (!Number.isSafeInteger(pid) || pid > 2_147_483_647) return 'unknown'
  try { process.kill(pid, 0); return 'live' }
  catch (error) { return errno(error) === 'ESRCH' ? 'dead' : 'unknown' }
}
function errno(error: unknown): string | undefined { return (error as NodeJS.ErrnoException | undefined)?.code }
function locked(message: string): MinerUError { return new MinerUError(failure('STORAGE_LOCKED', message)) }

/** No symlink is accepted in the configured root or coordination ancestry. */
async function ensureDirectory(path: string): Promise<void> {
  const absolute = resolve(path)
  const root = parse(absolute).root
  const parts: string[] = []
  for (let current = absolute; current !== root; current = dirname(current)) parts.push(current)
  for (const current of [root, ...parts.reverse()]) {
    if (current !== root) {
      try { await mkdir(current, { mode: 0o700 }) }
      catch (error) { if (errno(error) !== 'EEXIST') throw locked('Storage coordination directory could not be created') }
    }
    const details = await lstat(current)
    if (!details.isDirectory() || details.isSymbolicLink()) throw locked('Storage coordination paths must be real directories, not symlinks')
  }
}
async function readSmallFile(path: string, maxBytes: number): Promise<string | undefined> {
  let handle
  try {
    const before = await lstat(path)
    if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes) throw locked('Invalid storage coordination record')
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const current = await handle.stat()
    if (!current.isFile() || current.size > maxBytes || before.ino !== current.ino || before.dev !== current.dev) throw locked('Storage coordination record changed while opening')
    const buffer = Buffer.alloc(maxBytes + 1)
    let total = 0
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total)
      if (bytesRead === 0) break
      total += bytesRead
    }
    if (total > maxBytes) throw locked('Storage coordination record exceeds its size limit')
    return buffer.subarray(0, total).toString('utf8')
  } catch (error) {
    if (errno(error) === 'ENOENT') return undefined
    if (error instanceof MinerUError) throw error
    throw locked('Storage coordination record cannot be safely read')
  } finally { await handle?.close() }
}

interface Claim { readonly id: string; readonly ticket: number | undefined }
interface Lease { readonly scope: ProcessLockScope; release(): Promise<void> }

export class ProcessLock {
  private readonly lockDir: string
  private readonly claimsDir: string
  private readonly timeoutMs: number
  private readonly pollMs: number
  private queueTail: Promise<void> = Promise.resolve()
  private activeScope: ProcessLockScope | undefined
  private manualLease: Lease | undefined

  constructor(public readonly paths: StoragePaths, options: ProcessLockOptions = {}) {
    this.lockDir = join(paths.root, '.lock')
    this.claimsDir = join(this.lockDir, 'claims')
    this.timeoutMs = options.acquireTimeoutMs ?? 5000
    this.pollMs = options.pollIntervalMs ?? 15
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 120_000
      || !Number.isSafeInteger(this.pollMs) || this.pollMs < 1 || this.pollMs > 5000) {
      throw new TypeError('Invalid storage lock timeout or poll interval')
    }
  }
  /** Diagnostic only. Never grants another invocation mutation authority. */
  isHeld(): boolean { return this.activeScope !== undefined }
  get lockFilePath(): string { return this.paths.processLockFile() }
  assertScope(scope: ProcessLockScope): void {
    if (scope !== this.activeScope || scope === undefined) throw locked('The mutation scope is not active on this storage lock')
  }
  async withLock<T>(operation: (scope: ProcessLockScope) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const lease = await this.enter(signal)
    try { return await operation(lease.scope) }
    finally { await lease.release() }
  }
  /** Compatibility for explicit test/host owners; never called to borrow a held scope. */
  async acquire(signal?: AbortSignal): Promise<void> {
    if (this.manualLease !== undefined) throw locked('This owner already holds an explicit storage lock')
    this.manualLease = await this.enter(signal)
  }
  async release(): Promise<void> {
    const lease = this.manualLease
    this.manualLease = undefined
    await lease?.release()
  }

  async initialize(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    await ensureDirectory(this.paths.root)
    await this.ensureProtocolFence()
    await ensureDirectory(this.claimsDir)
    await ensureDirectory(join(this.lockDir, 'users'))
    signal?.throwIfAborted()
  }
  private async ensureProtocolFence(): Promise<void> {
    const path = this.paths.processLockFile()
    let raw = await readSmallFile(path, 1024)
    if (raw === undefined) {
      const temporary = join(this.paths.root, '.lock-fence-' + randomUUID() + '.tmp')
      try {
        await writeFile(temporary, JSON.stringify(FENCE), { flag: 'wx', mode: 0o600 })
        // Atomic no-replace publication. rename would overwrite a concurrent v1 owner.
        try { await link(temporary, path) }
        catch (error) { if (errno(error) !== 'EEXIST') throw locked('Storage protocol fence requires local filesystem hard-link support') }
      } finally { await rm(temporary, { force: true }) }
      raw = await readSmallFile(path, 1024)
    }
    let value: unknown
    try { value = JSON.parse(raw ?? '') } catch { value = undefined }
    const record = value as Partial<ProcessLockPayload> | undefined
    if (record === null || typeof record !== 'object' || record.pid !== FENCE.pid
      || record.ownerToken !== FENCE.ownerToken || record.createdAt !== 0 || record.hostname !== FENCE.hostname) {
      throw locked('Legacy or foreign storage lock: stop all MinerU processes before a coordinated upgrade and manual lock recovery; never remove a live lock')
    }
  }
  private async enter(signal?: AbortSignal): Promise<Lease> {
    const deadline = performance.now() + this.timeoutMs
    const releaseQueue = await this.enqueue(deadline, signal)
    let claimPath: string | undefined
    try {
      await this.initialize(signal)
      this.checkDeadline(deadline, signal)
      const id = createStorageOwnerId('c')
      const candidatePath = join(this.claimsDir, id)
      await mkdir(candidatePath, { mode: 0o700 })
      claimPath = candidatePath // Own only after successful exclusive directory creation.
      const claims = await this.scanClaims(signal)
      const max = claims.reduce((value, claim) => Math.max(value, claim.ticket ?? 0), 0)
      if (max >= Number.MAX_SAFE_INTEGER) throw locked('Storage lock ticket range is exhausted')
      const ticket = max + 1
      const temporary = join(claimPath, 'choosing.tmp')
      await writeFile(temporary, String(ticket), { flag: 'wx', mode: 0o600 })
      await rename(temporary, join(claimPath, 'ticket'))
      for (;;) {
        this.checkDeadline(deadline, signal)
        const current = await this.scanClaims(signal)
        const blocked = current.some(claim => claim.id !== id && (claim.ticket === undefined
          || claim.ticket < ticket || (claim.ticket === ticket && claim.id < id)))
        if (!blocked) break
        try { await sleep(Math.min(this.pollMs, Math.max(1, deadline - performance.now())), undefined, { signal }) }
        catch (error) { signal?.throwIfAborted(); throw error }
      }
      const scope: ProcessLockScope = Object.freeze({ [scopeBrand]: true as const })
      this.activeScope = scope
      const ownedPath = claimPath
      let released = false
      return { scope, release: async () => {
        if (released) return
        released = true
        this.activeScope = undefined
        try { await rm(ownedPath, { recursive: true, force: true }) }
        finally { releaseQueue() }
      } }
    } catch (error) {
      try { if (claimPath !== undefined) await rm(claimPath, { recursive: true, force: true }) }
      finally { releaseQueue() }
      throw error
    }
  }
  private checkDeadline(deadline: number, signal?: AbortSignal): void {
    signal?.throwIfAborted()
    if (performance.now() >= deadline) throw locked('Storage lock contention timed out; retry after active work completes')
  }
  private async enqueue(deadline: number, signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted()
    let release!: () => void
    const slot = new Promise<void>(resolve => { release = resolve })
    const previous = this.queueTail
    this.queueTail = previous.then(() => slot)
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => { cleanup(); reject(locked('Storage lock contention timed out in the local queue')) }, Math.max(1, deadline - performance.now()))
        const onAbort = (): void => { cleanup(); reject(signal?.reason) }
        const cleanup = (): void => { clearTimeout(timeout); signal?.removeEventListener('abort', onAbort) }
        signal?.addEventListener('abort', onAbort, { once: true })
        if (signal?.aborted) { onAbort(); return }
        void previous.then(() => { cleanup(); resolve() })
      })
      this.checkDeadline(deadline, signal)
      return release
    } catch (error) { release(); throw error }
  }
  private async scanClaims(signal?: AbortSignal): Promise<Claim[]> {
    const result: Claim[] = []
    const directory = await opendir(this.claimsDir)
    let count = 0
    for await (const entry of directory) {
      signal?.throwIfAborted()
      if (++count > MAX_CLAIMS) throw locked('Storage lock contender limit exceeded')
      if (!entry.name.startsWith('c_') || !entry.isDirectory() || entry.isSymbolicLink()) throw locked('Invalid storage lock claim')
      const state = storageOwnerState(entry.name)
      if (state === 'unknown' || state === 'foreign') throw locked('Storage lock owner cannot be safely verified on this host')
      const path = join(this.claimsDir, entry.name)
      if (state === 'dead') {
        await rm(path, { recursive: true, force: true })
        continue
      }
      const raw = await readSmallFile(join(path, 'ticket'), 32)
      if (raw === undefined) {
        // A disappeared claim is not a chooser. A live ticketless directory is.
        try { await lstat(path) } catch (error) { if (errno(error) === 'ENOENT') continue; throw error }
        result.push({ id: entry.name, ticket: undefined })
      } else {
        const ticket = Number(raw)
        if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(ticket)) throw locked('Invalid storage lock ticket')
        result.push({ id: entry.name, ticket })
      }
    }
    return result
  }
}
