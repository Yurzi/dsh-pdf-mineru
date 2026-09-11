/**
 * Build fixed Node arguments for the local PDF.js renderer. The final four
 * arguments are the worker protocol: snapshot, output, page, and byte limit.
 */
export declare function buildPdfjsArgs(snapshotPath: string, outputPath: string, page: number, maxFileBytes: number): string[];
