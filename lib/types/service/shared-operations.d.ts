import { type MinerUFailure } from '../domain/errors.js';
import type { CacheKey, MinerUResultId, OperationId, ProviderConfigId } from '../domain/ids.js';
export interface SharedOutcome {
    readonly state: 'completed' | 'failed';
    readonly resultId?: MinerUResultId;
    readonly failure?: MinerUFailure;
}
/** One process-local producer shared by foreground calls and native DSH jobs. */
export declare class SharedOperation {
    readonly cacheKey: CacheKey;
    readonly id: OperationId;
    readonly controller: AbortController;
    private readonly outcome;
    private settled;
    private outcomeValue;
    private waiters;
    constructor(cacheKey: CacheKey);
    get settledValue(): SharedOutcome | undefined;
    get waiterCount(): number;
    resolve(value: SharedOutcome): void;
    reject(error: unknown): void;
    waitForOutcome(signal: AbortSignal): Promise<SharedOutcome>;
    abort(reason: unknown): void;
}
export declare class SharedOperationRegistry {
    private readonly operations;
    private disposed;
    private readonly operationKeys;
    private readonly operationTimeouts;
    private readonly started;
    private readonly runners;
    reserve(cacheKey: CacheKey, authority: ProviderConfigId, timeoutMs: number): {
        readonly operation: SharedOperation;
        readonly created: boolean;
    };
    start(operation: SharedOperation, runner: (operation: SharedOperation) => Promise<SharedOutcome>): void;
    release(operation: SharedOperation, error: unknown): boolean;
    acquire(cacheKey: CacheKey, authority: ProviderConfigId, timeoutMs: number, runner: (operation: SharedOperation) => Promise<SharedOutcome>): {
        readonly operation: SharedOperation;
        readonly created: boolean;
    };
    get(cacheKey: CacheKey, authority: ProviderConfigId): SharedOperation | undefined;
    activeOperationIds(): ReadonlySet<OperationId>;
    activeOperationCount(): number;
    dispose(): void;
    shutdown(): Promise<void>;
}
