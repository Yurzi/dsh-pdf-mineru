import { type FocusKind } from '../domain/request.js';
/** Cursor payload version. Bump only with an explicit compatibility rule. */
export declare const READ_CURSOR_VERSION: 1;
/** Hard cap on the encoded cursor length (base64url JSON). */
export declare const MAX_CURSOR_LENGTH: 2048;
/** Hard cap on encoded canonical selection complexity (pages + focus tokens). */
export declare const MAX_CURSOR_SELECTION_CHARS: 1024;
export interface ReadCursorPayload {
    readonly v: typeof READ_CURSOR_VERSION;
    /** Immutable result identity the offset belongs to. */
    readonly rid: string;
    /** Canonical pages label ('' means the full selection). */
    readonly pages: string;
    /** Canonical sorted focus list. */
    readonly focus: readonly FocusKind[];
    /** UTF-16 offset into the exact projected selection text. */
    readonly off: number;
}
export interface ResolvedSelection {
    readonly pages: ReadonlySet<number> | undefined;
    readonly focus: ReadonlySet<FocusKind>;
}
/** Encode a cursor bound to one result identity, selection, and text offset. */
export declare function encodeReadCursor(payload: ReadCursorPayload): string;
/** Decode and structurally validate a cursor token. Never throws MinerUError. */
export declare function decodeReadCursor(token: string): ReadCursorPayload;
/** Resolve the canonical selection stored in a decoded cursor. */
export declare function selectionFromCursor(payload: ReadCursorPayload): ResolvedSelection;
/** Canonical pages label for cursor binding ('' means full selection). */
export declare function canonicalSelectionKey(pagesLabel: string | undefined, focus: ReadonlySet<FocusKind>): string;
/** Create a cursor for the remainder of projected text starting at offset. */
export declare function cursorForRemainder(resultId: string, pagesLabel: string | undefined, focus: ReadonlySet<FocusKind>, offset: number): string;
