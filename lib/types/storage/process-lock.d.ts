import type { StoragePaths } from './paths.js';
export interface ProcessLockPayload {
    readonly pid: number;
    readonly ownerToken: string;
    readonly createdAt: number;
    readonly hostname: string;
}
export interface ProcessLockOptions {
    readonly acquireTimeoutMs?: number;
    readonly pollIntervalMs?: number;
}
declare const scopeBrand: unique symbol;
export interface ProcessLockScope {
    readonly [scopeBrand]: true;
}
export declare function createStorageOwnerId(prefix: 'c' | 'u', pid?: number): string;
export declare function storageOwnerState(id: string): 'live' | 'dead' | 'foreign' | 'unknown';
export declare class ProcessLock {
    readonly paths: StoragePaths;
    private readonly lockDir;
    private readonly claimsDir;
    private readonly timeoutMs;
    private readonly pollMs;
    private queueTail;
    private activeScope;
    private manualLease;
    constructor(paths: StoragePaths, options?: ProcessLockOptions);
    /** Diagnostic only. Never grants another invocation mutation authority. */
    isHeld(): boolean;
    get lockFilePath(): string;
    assertScope(scope: ProcessLockScope): void;
    withLock<T>(operation: (scope: ProcessLockScope) => Promise<T>, signal?: AbortSignal): Promise<T>;
    /** Compatibility for explicit test/host owners; never called to borrow a held scope. */
    acquire(signal?: AbortSignal): Promise<void>;
    release(): Promise<void>;
    initialize(signal?: AbortSignal): Promise<void>;
    private ensureProtocolFence;
    private enter;
    private checkDeadline;
    private enqueue;
    private scanClaims;
}
export {};
