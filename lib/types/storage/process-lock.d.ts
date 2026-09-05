/**
 * process-lock.ts — Fail-closed single-process storageRoot lock.
 *
 * Prevents multiple concurrent DSH processes from mutating the same storageRoot.
 * Uses a cross-platform atomic file lock on this.lockFilePath with dead PID reclamation.
 */
import type { StoragePaths } from './paths.js';
export interface ProcessLockPayload {
    readonly pid: number;
    readonly ownerToken: string;
    readonly createdAt: number;
    readonly hostname: string;
}
export declare class ProcessLock {
    readonly paths: StoragePaths;
    private readonly lockFilePath;
    private readonly ownerToken;
    private acquired;
    constructor(paths: StoragePaths);
    isHeld(): boolean;
    /**
     * Executes a critical section with exclusive scoped lock authority,
     * acquiring the lock on entry and automatically releasing it on exit.
     */
    withLock<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T>;
    acquire(signal?: AbortSignal): Promise<void>;
    release(): Promise<void>;
}
