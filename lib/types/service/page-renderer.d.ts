import type { MinerUDiagnosticSink } from '../observability.js';
/** Aspect-preserving Poppler target: the longer page edge is capped at 1600 pixels. */
export declare const PDF_PAGE_MAX_LONG_EDGE = 1600;
/** Defensive validation envelope retained independently from Poppler's scale target. */
export declare const MAX_PDF_PAGE_WIDTH = 1600;
export declare const MAX_PDF_PAGE_HEIGHT = 2000;
export declare const MAX_PDF_PAGE_PIXELS: number;
export declare const MAX_RENDERED_PNG_BYTES: number;
export declare const MAX_PDF_PAGE_RENDER_CONCURRENCY = 2;
export declare const PDF_PAGE_RENDER_TIMEOUT_MS = 45000;
export interface RenderPdfPageInput {
    readonly file_path: string;
    readonly page: number;
    readonly cwd?: string;
    readonly maxFileBytes: number;
    readonly signal: AbortSignal;
    readonly expectedSha256?: string;
}
export interface RenderedPdfPage {
    readonly name: string;
    readonly page: number;
    readonly page_count: number;
    /** SHA-256 of the immutable source snapshot, not the rendered PNG. */
    readonly sha256: string;
    readonly data: Uint8Array;
    readonly media_type: 'image/png';
    readonly width?: number;
    readonly height?: number;
}
export interface PdfPageProcessRequest {
    readonly command: 'pdfinfo' | 'pdftoppm';
    readonly args: readonly string[];
    readonly cwd: string;
    readonly signal: AbortSignal;
    readonly timeoutMs: number;
    readonly maxStdoutBytes: number;
    readonly maxStderrBytes: number;
    /** A private output path which may be watched and terminated if it grows too large. */
    readonly watchedOutput?: Readonly<{
        path: string;
        maxBytes: number;
    }>;
}
export interface PdfPageProcessResult {
    readonly exitCode: number | null;
    readonly signal: NodeJS.Signals | null;
    readonly stdout: Uint8Array;
    readonly stderr: Uint8Array;
}
export type PdfPageProcessRunner = (request: PdfPageProcessRequest) => Promise<PdfPageProcessResult>;
export interface PdfPageRendererDependencies {
    readonly runProcess?: PdfPageProcessRunner;
    readonly temporaryRoot?: string;
    readonly maxConcurrency?: number;
    readonly runtimeMs?: number;
    /** Testable cleanup seam; production defaults to recursive removal with retries. */
    readonly removeTemporaryDirectory?: (path: string) => Promise<void>;
    readonly diagnostics?: MinerUDiagnosticSink;
}
/** Spawn one fixed local Poppler command without a shell and resolve only after it closes. */
export declare const runPdfPageProcess: PdfPageProcessRunner;
export declare function createPdfPageRenderer(dependencies?: PdfPageRendererDependencies): (input: RenderPdfPageInput) => Promise<RenderedPdfPage>;
export declare const renderPdfPage: (input: RenderPdfPageInput) => Promise<RenderedPdfPage>;
