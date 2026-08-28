import type { MinerUFileId } from './ids.js';
export declare const CANONICAL_PARSE_REQUEST_SCHEMA_VERSION: 1;
export declare const CACHE_KEY_SPEC_VERSION: 1;
export declare const RESULT_SCHEMA_VERSION: 1;
export declare const ARTIFACT_KINDS: readonly ["markdown", "layout", "model-output", "content-list", "images"];
export type ArtifactKind = typeof ARTIFACT_KINDS[number];
export type MinerUModel = 'pipeline' | 'vlm';
export type ParseMethod = 'auto' | 'txt' | 'ocr';
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
export interface ParseRequestInput {
    readonly file_paths?: readonly string[];
    readonly model?: MinerUModel;
    readonly ocr?: boolean;
    readonly language?: string;
    readonly formula?: boolean;
    readonly table?: boolean;
    readonly pages?: string;
    readonly artifacts?: readonly ArtifactKind[];
}
export interface ParseDefaults {
    readonly model: MinerUModel;
    readonly ocr: boolean;
    readonly parseMethod: ParseMethod;
    readonly language: string;
    readonly formula: boolean;
    readonly table: boolean;
    readonly artifacts: readonly ArtifactKind[];
}
export declare function normalizePageRanges(input: string): string;
export declare function normalizeArtifactKinds(kinds: readonly ArtifactKind[]): readonly ArtifactKind[];
