import { MinerUError, failure, type MinerUFailure } from '../domain/errors.js'
import type { CacheKey, MinerUResultId, OperationId, ProviderConfigId } from '../domain/ids.js'
import { createOperationId } from '../domain/ids.js'

export interface SharedOutcome {
  readonly state: 'completed' | 'failed'
  readonly resultId?: MinerUResultId
  readonly failure?: MinerUFailure
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

/** One process-local producer shared by foreground calls and native DSH jobs. */
export class SharedOperation {
  readonly id: OperationId = createOperationId()
  readonly controller = new AbortController()
  private readonly outcome = deferred<SharedOutcome>()
  private settled = false
  private outcomeValue: SharedOutcome | undefined
  private waiters = 0

  constructor(readonly cacheKey: CacheKey) {
    void this.outcome.promise.catch(() => undefined)
  }

  get settledValue(): SharedOutcome | undefined { return this.outcomeValue }
  get waiterCount(): number { return this.waiters }

  resolve(value: SharedOutcome): void {
    if (this.settled) return
    this.settled = true
    this.outcomeValue = value
    this.outcome.resolve(value)
  }

  reject(error: unknown): void {
    if (this.settled) return
    this.settled = true
    this.outcome.reject(error)
  }

  async waitForOutcome(signal: AbortSignal): Promise<SharedOutcome> {
    this.waiters++
    try {
      return await waitWithSignal(this.outcome.promise, signal)
    } finally {
      this.waiters--
    }
  }

  abort(reason: unknown): void {
    if (!this.controller.signal.aborted) this.controller.abort(reason)
  }
}

export class SharedOperationRegistry {
  private readonly operations = new Map<string, SharedOperation>()
  private disposed = false
  private readonly operationKeys = new WeakMap<SharedOperation, string>()
  private readonly operationTimeouts = new WeakMap<SharedOperation, number>()
  private readonly started = new WeakSet<SharedOperation>()
  private readonly runners = new Set<Promise<void>>()

  reserve(
    cacheKey: CacheKey, authority: ProviderConfigId, timeoutMs: number,
  ): { readonly operation: SharedOperation; readonly created: boolean } {
    if (this.disposed) throw new MinerUError(failure('PROVIDER_UNAVAILABLE', 'MinerU service is shutting down', true))
    const operationKey = `${cacheKey}:${authority}`
    const existing = this.operations.get(operationKey)
    if (existing !== undefined) return { operation: existing, created: false }
    const operation = new SharedOperation(cacheKey)
    this.operations.set(operationKey, operation)
    this.operationKeys.set(operation, operationKey)
    this.operationTimeouts.set(operation, timeoutMs)
    return { operation, created: true }
  }

  start(operation: SharedOperation, runner: (operation: SharedOperation) => Promise<SharedOutcome>): void {
    const operationKey = this.operationKeys.get(operation)
    if (operationKey === undefined || this.operations.get(operationKey) !== operation) {
      throw new TypeError('Shared operation is not reserved in this registry')
    }
    if (this.started.has(operation)) throw new TypeError('Shared operation has already been started')
    this.started.add(operation)
    const timeout = setTimeout(() => {
      operation.abort(new MinerUError(failure('POLL_TIMEOUT', 'Shared MinerU operation timed out', true)))
    }, this.operationTimeouts.get(operation) ?? 1)
    timeout.unref?.()
    const running = Promise.resolve()
      .then(() => runner(operation))
      .then(outcome => operation.resolve(outcome), error => operation.reject(error))
      .finally(() => {
        clearTimeout(timeout)
        this.runners.delete(running)
        if (this.operations.get(operationKey) === operation) this.operations.delete(operationKey)
      })
    this.runners.add(running)
  }

  release(operation: SharedOperation, error: unknown): boolean {
    const operationKey = this.operationKeys.get(operation)
    if (operationKey === undefined || this.operations.get(operationKey) !== operation || this.started.has(operation)) {
      return false
    }
    this.operations.delete(operationKey)
    operation.reject(error)
    return true
  }

  acquire(
    cacheKey: CacheKey, authority: ProviderConfigId, timeoutMs: number,
    runner: (operation: SharedOperation) => Promise<SharedOutcome>,
  ): { readonly operation: SharedOperation; readonly created: boolean } {
    const reserved = this.reserve(cacheKey, authority, timeoutMs)
    if (reserved.created) this.start(reserved.operation, runner)
    return reserved
  }

  get(cacheKey: CacheKey, authority: ProviderConfigId): SharedOperation | undefined {
    return this.operations.get(`${cacheKey}:${authority}`)
  }

  activeOperationIds(): ReadonlySet<OperationId> {
    return new Set([...this.operations.values()].map(operation => operation.id))
  }

  activeOperationCount(): number {
    return this.operations.size
  }

  dispose(): void {
    this.disposed = true
    const error = new MinerUError(failure('CANCELLED', 'MinerU plugin disposed', true))
    for (const operation of [...this.operations.values()]) {
      if (!this.release(operation, error)) operation.abort(error)
    }
  }

  async shutdown(): Promise<void> {
    this.dispose()
    await Promise.allSettled([...this.runners])
  }
}
