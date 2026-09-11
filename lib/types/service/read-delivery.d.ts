import { type ReadCursorPayload } from './read-cursor.js';
import { type ImageCandidateView, type ProjectedBlockRange, type ReadDiagnostic, type VerificationHint, type ResultView } from './result-presenter.js';
import type { FocusKind } from '../domain/request.js';
/** Below DSH console object's 10,000-character string preview limit. */
export declare const MAX_MODEL_MARKDOWN_CHARS = 8000;
export declare const MAX_MODEL_RESPONSE_BYTES = 48000;
export declare function boundedWarnings(warnings: readonly string[]): string[];
export declare function fitsReadBudget(view: ResultView): boolean;
/** Last-resort metadata degradation never changes text, status, cursor, or image records. */
export declare function compactReadMetadata(value: ResultView): ResultView;
export declare function deliverReadChunk(options: {
    base: ResultView;
    text: string;
    focus: ReadonlySet<FocusKind>;
    images: readonly ImageCandidateView[];
    cursor?: ReadCursorPayload;
    selection?: {
        block?: string;
        query?: string;
    };
    ranges?: readonly ProjectedBlockRange[];
    identity?: string;
    signal?: AbortSignal;
    inlineImages?: boolean;
    diagnosticsForBlocks?: (ids: ReadonlySet<string>) => readonly ReadDiagnostic[];
    verificationHints?: readonly VerificationHint[];
    scopeDiagnostics?: readonly ReadDiagnostic[];
}): ResultView;
