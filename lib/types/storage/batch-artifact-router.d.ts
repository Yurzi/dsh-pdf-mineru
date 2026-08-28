import type { MinerUFileId } from '../domain/ids.js';
import type { ArtifactKind } from '../domain/request.js';
import type { ArtifactInput, ArtifactSink, ArtifactWriteOptions, TemporaryArtifact } from '../providers/provider.js';
import type { ArtifactRef } from '../domain/result.js';
import type { ResultTransaction } from './result-repository.js';
export interface BatchArtifactParticipant {
    readonly fileId: MinerUFileId;
    readonly transaction: ResultTransaction;
}
export declare class BatchArtifactRouter implements ArtifactSink {
    private readonly transactions;
    private readonly temporaryOwner;
    constructor(participants: readonly BatchArtifactParticipant[]);
    transaction(fileId: MinerUFileId): ResultTransaction;
    writeArtifact(fileId: MinerUFileId, kind: ArtifactKind, input: ArtifactInput, options: ArtifactWriteOptions): Promise<ArtifactRef>;
    writeTemporary(name: string, input: ArtifactInput, maxBytes: number): Promise<TemporaryArtifact>;
    abortUncommitted(committed?: ReadonlySet<MinerUFileId>): Promise<void>;
}
