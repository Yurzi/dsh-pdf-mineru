import { type Entry } from 'yauzl';
import type { ArtifactKind } from '../domain/request.js';
import type { ArtifactSink, ProviderCollectedFile } from './provider.js';
import type { ExtractZipTargetFile, SafeZipLimits } from './official-v4-types.js';
export interface SafeZipOptions {
    readonly zipPath: string;
    readonly sink: ArtifactSink;
    readonly files: readonly ExtractZipTargetFile[];
    readonly requiredArtifacts: readonly ArtifactKind[];
    readonly limits: SafeZipLimits;
    readonly signal: AbortSignal;
}
export interface ZipEntryMetadata {
    readonly fileName: string;
    readonly directory: boolean;
    readonly compressedBytes: number;
    readonly uncompressedBytes: number;
}
export declare function validateEntrySecurity(entry: Entry, limits: SafeZipLimits): void;
/** Security-focused compatibility helper: scans metadata and drains no entry into memory. */
export declare function readAllZipEntries(zipPath: string, limits: SafeZipLimits, signal: AbortSignal): Promise<ZipEntryMetadata[]>;
export declare function validateJsonFile(path: string, maxBytes?: number, signal?: AbortSignal): Promise<void>;
export declare function extractSafeZip(options: SafeZipOptions): Promise<ProviderCollectedFile[]>;
