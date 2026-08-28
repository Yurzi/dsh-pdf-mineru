/**
 * schemas.ts — Strict runtime parsers and validators for persistent domain JSON records.
 *
 * Enforces:
 *   - Pinned schemaVersion validation (unknown versions rejected)
 *   - Closed record shapes (additional/unknown properties rejected)
 *   - Safe, branded identifier validation
 *   - Clean POSIX relative paths for artifact references (rejection of traversal, absolute paths, NUL, backslashes)
 *   - Elimination of local source paths, tokens, query parameters, presigned/CDN URLs from persistent records
 */
import { type ArtifactKind, type CanonicalParseRequest, type CanonicalSourceFile, type MinerUModel, type ParseMethod, type ParseSemantics } from './request.js';
import { type JobResolution, type JobSourceFile, type MinerUFileState, type MinerUFileStatus, type MinerUJobRecord, type MinerUJobState } from './job.js';
import { type ArtifactRef, type ParsedDocumentManifest, type ResultProducer, type MinerUResultManifest } from './result.js';
import type { MinerUErrorCode, MinerUFailure, MinerUProviderId } from './errors.js';
import type { ProviderJobRef, ProviderSubmittedFile } from '../providers/provider.js';
export declare const VALID_JOB_STATES: Set<MinerUJobState>;
export declare const VALID_FILE_STATES: Set<MinerUFileState>;
export declare const VALID_MODELS: Set<MinerUModel>;
export declare const VALID_PARSE_METHODS: Set<ParseMethod>;
export declare const VALID_PROVIDERS: Set<MinerUProviderId>;
export declare const VALID_ARTIFACT_KINDS: Set<"markdown" | "layout" | "model-output" | "content-list" | "images">;
export declare const VALID_ERROR_CODES: Set<MinerUErrorCode>;
export declare function assertPlainObject(value: unknown, label: string): Record<string, unknown>;
export declare function assertNoAdditionalProperties(record: Record<string, unknown>, allowedKeys: readonly string[], label: string): void;
export declare function assertNonEmptyString(value: unknown, label: string): string;
export declare function assertNonNegativeSafeInteger(value: unknown, label: string): number;
export declare function assertSha256(value: unknown, label?: string): string;
export declare function assertNoUrlOrSecret(value: string, label: string): string;
export declare function assertSafeFileName(value: unknown, label?: string): string;
export declare function assertSafeArtifactRelativePath(value: unknown, label?: string): string;
export declare function parseArtifactKind(input: unknown): ArtifactKind;
export declare function parseParseSemantics(input: unknown): ParseSemantics;
export declare function parseCanonicalSourceFile(input: unknown): CanonicalSourceFile;
export declare function parseCanonicalParseRequest(input: unknown): CanonicalParseRequest;
export declare function parseProviderSubmittedFile(input: unknown): ProviderSubmittedFile;
export declare function parseProviderJobRef(input: unknown): ProviderJobRef;
export declare function parseJobResolution(input: unknown): JobResolution;
export declare function parseJobSourceFile(input: unknown): JobSourceFile;
export declare function parseMinerUFailure(input: unknown): MinerUFailure;
export declare function parseMinerUFileStatus(input: unknown): MinerUFileStatus;
export declare function parseMinerUJobRecord(input: unknown): MinerUJobRecord;
export declare function parseArtifactRef(input: unknown): ArtifactRef;
export declare function parseParsedDocumentManifest(input: unknown): ParsedDocumentManifest;
export declare function parseResultProducer(input: unknown): ResultProducer;
export declare function parseMinerUResultManifest(input: unknown): MinerUResultManifest;
