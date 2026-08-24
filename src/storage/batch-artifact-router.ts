import type { MinerUFileId } from '../domain/ids.js'
import type { ArtifactKind } from '../domain/request.js'
import type { ArtifactInput, ArtifactSink, ArtifactWriteOptions, TemporaryArtifact } from '../providers/provider.js'
import type { ArtifactRef } from '../domain/result.js'
import type { ResultTransaction } from './result-repository.js'

export interface BatchArtifactParticipant {
  readonly fileId: MinerUFileId
  readonly transaction: ResultTransaction
}

export class BatchArtifactRouter implements ArtifactSink {
  private readonly transactions = new Map<MinerUFileId, ResultTransaction>()
  private readonly temporaryOwner: ResultTransaction

  constructor(participants: readonly BatchArtifactParticipant[]) {
    if (participants.length === 0) throw new TypeError('Batch artifact router requires at least one participant')
    for (const participant of participants) {
      if (this.transactions.has(participant.fileId)) throw new TypeError('Batch artifact router contains duplicate fileId')
      this.transactions.set(participant.fileId, participant.transaction)
    }
    this.temporaryOwner = participants[0]!.transaction
  }

  transaction(fileId: MinerUFileId): ResultTransaction {
    const transaction = this.transactions.get(fileId)
    if (transaction === undefined) throw new TypeError('Provider wrote an artifact for an unknown batch fileId')
    return transaction
  }

  writeArtifact(
    fileId: MinerUFileId, kind: ArtifactKind, input: ArtifactInput, options: ArtifactWriteOptions,
  ): Promise<ArtifactRef> {
    return this.transaction(fileId).writeArtifact(fileId, kind, input, options)
  }

  writeTemporary(name: string, input: ArtifactInput, maxBytes: number): Promise<TemporaryArtifact> {
    return this.temporaryOwner.writeTemporary(name, input, maxBytes)
  }

  async abortUncommitted(committed: ReadonlySet<MinerUFileId> = new Set()): Promise<void> {
    await Promise.all([...this.transactions].map(async ([fileId, transaction]) => {
      if (!committed.has(fileId)) await transaction.abort().catch(() => undefined)
    }))
  }
}
