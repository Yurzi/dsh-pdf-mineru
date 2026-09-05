/**
 * Computes the SHA-256 hexadecimal digest of a local file via streaming.
 * Respects an optional AbortSignal and cleans up listeners and streams.
 */
export declare function computeFileSha256(filePath: string, signal?: AbortSignal): Promise<string>;
