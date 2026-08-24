import { MinerUError, failure } from '../domain/errors.js'
import type { MinerUFileId } from '../domain/ids.js'
import type { CanonicalParseRequest, PreparedSourceFile } from '../domain/request.js'
import type { ArtifactSink, ProviderCallContext, ProviderCollectedFile, ProviderJobRef, ProviderJobSnapshot } from '../providers/provider.js'
import type { ResolvedProvider } from '../providers/registry.js'
import type { SharedOperation, SharedOutcome } from './shared-operations.js'

export interface BatchParticipant {
  readonly request: CanonicalParseRequest
  readonly source: PreparedSourceFile
  readonly operation: SharedOperation
  accepted(ref: ProviderJobRef): Promise<void>
  snapshot(snapshot: ProviderJobSnapshot): Promise<void>
  collected(file: ProviderCollectedFile): Promise<SharedOutcome>
  failed(error: unknown): Promise<SharedOutcome>
}

export interface BatchCoordinatorOptions {
  readonly participants: readonly BatchParticipant[]
  readonly resolved: ResolvedProvider
  readonly sink: ArtifactSink
  readonly pollIntervalMs: number
  readonly timeoutMs: number
  createContext(signal: AbortSignal): Promise<ProviderCallContext>
  unregister(): void
}

export function projectProviderRef(ref: ProviderJobRef, fileId: MinerUFileId): ProviderJobRef {
  const files = ref.files.filter(file => file.fileId === fileId)
  if (files.length !== 1) throw new TypeError('Provider batch reference does not contain exactly one participant mapping')
  return ref.provider === 'official-v4'
    ? { provider: ref.provider, batchId: ref.batchId, files }
    : { provider: ref.provider, taskId: ref.taskId, files }
}

export function projectProviderSnapshot(
  snapshot: Pick<ProviderJobSnapshot, 'state' | 'files' | 'rawState' | 'queuedAhead'>, fileId: MinerUFileId,
): ProviderJobSnapshot {
  const files = snapshot.files.filter(file => file.fileId === fileId)
  const file = files[0]
  if (file === undefined) throw new TypeError('Provider batch snapshot does not contain participant file')
  return {
    state: file.state === 'completed' || file.state === 'failed' ? file.state : 'processing', files,
    ...(snapshot.rawState === undefined ? {} : { rawState: snapshot.rawState }),
    ...(snapshot.queuedAhead === undefined ? {} : { queuedAhead: snapshot.queuedAhead }),
  }
}

function combineRequest(participants: readonly BatchParticipant[]): CanonicalParseRequest {
  const first = participants[0]?.request
  if (first === undefined || participants.some(participant => participant.request.files.length !== 1)) {
    throw new TypeError('Batch participants must each own exactly one request file')
  }
  return { ...first, files: participants.map(participant => participant.request.files[0]!) }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const finish = (): void => { signal.removeEventListener('abort', abort); resolve() }
    const timer = setTimeout(finish, ms)
    const abort = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', abort, { once: true })
    ;(timer as NodeJS.Timeout).unref?.()
  })
}

export class BatchCoordinator {
  readonly controller = new AbortController()
  private readonly runPromise: Promise<void>

  constructor(private readonly options: BatchCoordinatorOptions) {
    this.runPromise = this.execute()
    void this.runPromise.catch(() => undefined)
  }

  run(): Promise<void> { return this.runPromise }

  abort(reason: unknown): void {
    if (!this.controller.signal.aborted) this.controller.abort(reason)
  }

  private async execute(): Promise<void> {
    const participants = this.options.participants
    const timer = setTimeout(() => this.abort(new MinerUError(failure('POLL_TIMEOUT', 'MinerU batch operation timed out', true))), this.options.timeoutMs)
    timer.unref?.()
    try {
      const request = combineRequest(participants)
      const context = await this.options.createContext(this.controller.signal)
      const submission = await this.options.resolved.provider.submit(
        request, participants.map(participant => participant.source), {
          ...context, signal: this.controller.signal,
          onAccepted: async fullRef => {
            await Promise.all(participants.map(async participant => {
              const fileId = participant.request.files[0]!.fileId
              const projected = projectProviderRef(fullRef, fileId)
              participant.operation.markAccepted(projected)
              await participant.accepted(projected)
            }))
          },
        },
      )
      const fullRef = submission.ref
      await Promise.all(participants.map(async participant => {
        const fileId = participant.request.files[0]!.fileId
        participant.operation.markSubmitted({ state: projectProviderSnapshot(submission, fileId).state, ref: projectProviderRef(fullRef, fileId) })
      }))

      let snapshot: ProviderJobSnapshot = submission
      while (snapshot.files.some(file => file.state !== 'completed' && file.state !== 'failed')) {
        await delay(this.options.pollIntervalMs, this.controller.signal)
        snapshot = await this.options.resolved.provider.inspect(fullRef, await this.options.createContext(this.controller.signal))
        await Promise.all(participants.map(participant => participant.snapshot(
          projectProviderSnapshot(snapshot, participant.request.files[0]!.fileId),
        )))
      }

      const collection = await this.options.resolved.provider.collect(
        fullRef, request, this.options.sink, await this.options.createContext(this.controller.signal),
      )
      const byFile = new Map(collection.files.map(file => [file.fileId, file]))
      await Promise.all(participants.map(async participant => {
        const fileId = participant.request.files[0]!.fileId
        const file = byFile.get(fileId)
        const outcome = file === undefined
          ? await participant.failed(new TypeError('Provider collection omitted a batch participant'))
          : await participant.collected(file)
        participant.operation.resolve(outcome)
      }))
    } catch (error) {
      await Promise.all(this.options.participants.map(async participant => {
        if (participant.operation.settledValue !== undefined) return
        try { participant.operation.resolve(await participant.failed(error)) } catch (failureError) { participant.operation.reject(failureError) }
      }))
      throw error
    } finally {
      clearTimeout(timer)
      this.options.unregister()
    }
  }
}
