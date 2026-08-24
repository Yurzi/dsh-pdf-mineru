import { MinerUError, failure } from '../domain/errors.js'
import type { CacheKey, MinerUJobId, MinerUResultId, OperationId, SessionId } from '../domain/ids.js'
import { createOperationId } from '../domain/ids.js'
import type { MinerUJobState } from '../domain/job.js'
import type { ProviderJobRef } from '../providers/provider.js'

export interface SharedWaiter {
  readonly jobId: MinerUJobId
  readonly sessionId: SessionId
  readonly session: { readonly header: { readonly id: SessionId | string } }
}

export interface SharedSubmission {
  readonly ref?: ProviderJobRef
  readonly state: MinerUJobState
}

export interface SharedOutcome {
  readonly state: Extract<MinerUJobState, 'completed' | 'partially-completed' | 'failed'>
  readonly resultId?: MinerUResultId
}

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function waitWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

export class SharedOperation {
  readonly id: OperationId = createOperationId()
  readonly waiters = new Map<MinerUJobId, SharedWaiter>()
  readonly controller = new AbortController()
  private readonly submission = deferred<SharedSubmission>()
  private readonly outcome = deferred<SharedOutcome>()
  private submitted = false
  private settled = false

  constructor(readonly cacheKey: CacheKey) {
    // Mark rejections handled even when an asynchronous submit caller goes away.
    void this.submission.promise.catch(() => undefined)
    void this.outcome.promise.catch(() => undefined)
  }

  attach(waiter: SharedWaiter): void {
    this.waiters.set(waiter.jobId, waiter)
  }

  markSubmitted(value: SharedSubmission): void {
    if (this.submitted) return
    this.submitted = true
    this.submission.resolve(value)
  }

  resolve(value: SharedOutcome): void {
    if (this.settled) return
    this.settled = true
    if (!this.submitted) this.markSubmitted({ state: value.state })
    this.outcome.resolve(value)
  }

  reject(error: unknown): void {
    if (this.settled) return
    this.settled = true
    if (!this.submitted) this.submission.reject(error)
    this.outcome.reject(error)
  }

  waitForSubmission(signal: AbortSignal): Promise<SharedSubmission> {
    return waitWithSignal(this.submission.promise, signal)
  }

  waitForOutcome(signal: AbortSignal): Promise<SharedOutcome> {
    return waitWithSignal(this.outcome.promise, signal)
  }

  abort(reason: unknown): void {
    if (!this.controller.signal.aborted) this.controller.abort(reason)
  }
}

export class SharedOperationRegistry {
  private readonly operations = new Map<CacheKey, SharedOperation>()
  private disposed = false

  acquire(cacheKey: CacheKey, timeoutMs: number, runner: (operation: SharedOperation) => Promise<SharedOutcome>): {
    readonly operation: SharedOperation
    readonly created: boolean
  } {
    if (this.disposed) throw new MinerUError(failure('PROVIDER_UNAVAILABLE', 'MinerU service is shutting down', true))
    const existing = this.operations.get(cacheKey)
    if (existing !== undefined) return { operation: existing, created: false }
    const operation = new SharedOperation(cacheKey)
    this.operations.set(cacheKey, operation)
    const timeout = setTimeout(() => {
      operation.abort(new MinerUError(failure('POLL_TIMEOUT', 'Shared MinerU operation timed out', true)))
    }, timeoutMs)
    timeout.unref?.()
    void Promise.resolve()
      .then(() => runner(operation))
      .then(outcome => operation.resolve(outcome), error => operation.reject(error))
      .finally(() => {
        clearTimeout(timeout)
        if (this.operations.get(cacheKey) === operation) this.operations.delete(cacheKey)
      })
    return { operation, created: true }
  }

  get(cacheKey: CacheKey): SharedOperation | undefined {
    return this.operations.get(cacheKey)
  }

  activeOperationIds(): ReadonlySet<OperationId> {
    return new Set([...this.operations.values()].map(operation => operation.id))
  }

  dispose(): void {
    this.disposed = true
    const error = new MinerUError(failure('CANCELLED', 'MinerU plugin disposed', true))
    for (const operation of this.operations.values()) operation.abort(error)
  }
}
