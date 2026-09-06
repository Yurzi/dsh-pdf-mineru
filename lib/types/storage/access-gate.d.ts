import type { StoragePaths } from './paths.js';
import { type ProcessLock, type ProcessLockScope } from './process-lock.js';
export type StorageUseRole = 'reader' | 'producer';
export interface StorageAccessGateOptions {
    readonly paths: StoragePaths;
    readonly lock: ProcessLock;
}
export interface StorageUseRecord {
    readonly id: string;
}
export type ClassifiedUseRecord = {
    readonly kind: 'active';
    readonly record: StorageUseRecord;
} | {
    readonly kind: 'dead';
    readonly id: string;
    readonly record: StorageUseRecord;
} | {
    readonly kind: 'unknown';
    readonly id: string;
};
/** Classify unique owner directories. Foreign and unverifiable owners fail closed. */
export declare function listUseRecords(paths: StoragePaths): Promise<readonly ClassifiedUseRecord[]>;
export declare class StorageAccessGate {
    private activeReaders;
    private exclusive;
    private readonly paths;
    private readonly lock;
    constructor(options?: StorageAccessGateOptions);
    get activeReaderCount(): number;
    runShared<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T>;
    /** Producer leases use the same owner protocol and cover the full producer lifetime. */
    runProducer<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T>;
    private runUse;
    /** Fail fast, then recheck and prune confirmed-dead records under the scoped mutex. */
    runMaintenance<T>(operation: (scope: ProcessLockScope) => Promise<T>, signal?: AbortSignal): Promise<T>;
    /** Local-only compatibility API. Destructive cross-process work uses runMaintenance. */
    tryAcquireExclusive(): (() => void) | undefined;
    private assertNoActiveRecords;
}
