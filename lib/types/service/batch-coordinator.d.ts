import type { CanonicalParseRequest, PreparedSourceFile } from '../domain/request.js';
import type { ArtifactSink, ProviderCallContext, ProviderCollectedFile } from '../providers/provider.js';
import type { ResolvedProvider } from '../providers/registry.js';
import type { SharedOperation, SharedOutcome } from './shared-operations.js';
export interface BatchParticipant {
    readonly request: CanonicalParseRequest;
    readonly source: PreparedSourceFile;
    readonly operation: SharedOperation;
    collected(file: ProviderCollectedFile): Promise<SharedOutcome>;
    failed(error: unknown): Promise<SharedOutcome>;
}
export interface BatchCoordinatorOptions {
    readonly participants: readonly BatchParticipant[];
    readonly resolved: ResolvedProvider;
    readonly sink: ArtifactSink;
    readonly pollIntervalMs: number;
    readonly timeoutMs: number;
    createContext(signal: AbortSignal): Promise<ProviderCallContext>;
    unregister(): void;
}
/** Runs one provider batch while each file keeps an independent cache operation. */
export declare class BatchCoordinator {
    private readonly options;
    readonly controller: AbortController;
    private readonly runPromise;
    constructor(options: BatchCoordinatorOptions);
    run(): Promise<void>;
    abort(reason: unknown): void;
    private execute;
}
