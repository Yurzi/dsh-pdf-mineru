/**
 * process-lock.ts — Fail-closed single-process storageRoot lock.
 *
 * Prevents multiple concurrent DSH processes from mutating the same storageRoot.
 * Linux uses an abstract Unix socket. Windows uses a named pipe to serialize
 * metadata acquisition/recovery; both IPC endpoints disappear on process death.
 * Windows also honors the file lock used by older plugin versions: only a
 * valid same-host record with a definitively dead PID may be reclaimed.
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
    private acquireWindowsMetadata;
    private reclaimDeadWindowsMetadata;
    private removeOwnedMetadata;
    release(): Promise<void>;
}
