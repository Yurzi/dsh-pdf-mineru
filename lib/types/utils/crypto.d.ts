/** Stream a file into SHA-256; Node owns cancellation listener cleanup. */
export declare function computeFileSha256(filePath: string, signal?: AbortSignal): Promise<string>;
