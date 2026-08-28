/**
 * process-lock.ts — Fail-closed single-process storageRoot lock.
 *
 * Prevents multiple concurrent DSH processes from mutating the same storageRoot.
 * Lock authority is a Linux abstract Unix socket, which the OS releases on
 * process death. The pathname file is ownership metadata only and can safely be
 * replaced after socket acquisition.
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
    private readonly socketName;
    private readonly ownerToken;
    private server;
    private acquired;
    constructor(paths: StoragePaths);
    isHeld(): boolean;
    acquire(signal?: AbortSignal): Promise<void>;
    release(): Promise<void>;
}
