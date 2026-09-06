import type { MinerUFileId } from './ids.js';
export declare const CANONICAL_PARSE_REQUEST_SCHEMA_VERSION: 1;
export declare const CACHE_KEY_SPEC_VERSION: 1;
export declare const RESULT_SCHEMA_VERSION: 1;
export declare const ARTIFACT_KINDS: readonly ["markdown", "layout", "model-output", "content-list", "images"];
export type ArtifactKind = typeof ARTIFACT_KINDS[number];
export type MinerUModel = 'pipeline' | 'vlm';
export type ParseMethod = 'auto' | 'txt' | 'ocr';
export declare const FOCUS_KINDS: readonly ["all", "text", "table", "image", "toc", "artifacts"];
export type FocusKind = typeof FOCUS_KINDS[number];
/** Public page selection: a single page, a range string, or an array of page numbers. */
export type PageSelection = number | string | readonly number[];
export interface ParseSemantics {
    readonly model: MinerUModel;
    readonly ocr: boolean;
    /** Parse method remains explicit because txt and auto have different cache semantics. */
    readonly parseMethod: ParseMethod;
    readonly language: string;
    readonly formula: boolean;
    readonly table: boolean;
    readonly pages?: string;
}
export interface CanonicalSourceFile {
    readonly fileId: MinerUFileId;
    readonly name: string;
    readonly bytes: number;
    readonly sha256: string;
}
export interface CanonicalParseRequest {
    readonly schemaVersion: typeof CANONICAL_PARSE_REQUEST_SCHEMA_VERSION;
    readonly files: readonly CanonicalSourceFile[];
    readonly semantics: ParseSemantics;
    readonly requiredArtifacts: readonly ArtifactKind[];
}
export interface PreparedSourceFile extends CanonicalSourceFile {
    /** Ephemeral execution input. This field is never persisted. */
    readonly path: string;
    readonly fingerprint: {
        readonly size: number;
        readonly mtimeMs: number;
        readonly device: number;
        readonly inode: number;
    };
}
export interface PreparedParseRequest {
    readonly request: CanonicalParseRequest;
    readonly sources: readonly PreparedSourceFile[];
}
export interface ReadCursorInput {
    /** Opaque continuation token from a previous partial read. */
    readonly cursor?: string;
}
export interface ParseRequestInput extends ReadCursorInput {
    readonly file_path?: string;
    readonly model?: MinerUModel;
    readonly ocr?: boolean;
    readonly language?: string;
    readonly formula?: boolean;
    readonly table?: boolean;
    readonly pages?: PageSelection;
    readonly focus?: FocusKind | readonly FocusKind[];
    readonly artifacts?: readonly ArtifactKind[];
    readonly inline_images?: boolean;
    readonly poll_timeout_ms?: number;
}
export interface ParseDefaults {
    readonly model: MinerUModel;
    readonly ocr: boolean;
    readonly parseMethod: ParseMethod;
    readonly language: string;
    readonly formula: boolean;
    readonly table: boolean;
}
export declare function normalizePageRanges(input: string): string;
export interface PageNarrowing {
    readonly pagesSet: Set<number> | undefined;
    readonly pagesLabel: string;
    /** Pages requested but outside 1..totalPages; reported, never silently replaced. */
    readonly outOfRange: readonly number[];
    /** True when the request asked for pages but none overlap the document. */
    readonly fullyOutOfRange: boolean;
}
export declare function narrowPageSelection(requested: ReadonlySet<number> | undefined, totalPages: number | undefined): PageNarrowing;
export declare function normalizePageSelection(input: unknown): Set<number> | undefined;
export declare function normalizeFocusSelection(input: unknown): Set<FocusKind>;
export declare function normalizeArtifactKinds(kinds: readonly ArtifactKind[]): readonly ArtifactKind[];
