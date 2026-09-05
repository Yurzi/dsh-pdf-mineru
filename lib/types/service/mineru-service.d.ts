import type { MinerUConfig, ProviderConfig } from '../config.js';
import type { MinerUFailure, MinerUProviderId } from '../domain/errors.js';
import type { ParseRequestInput } from '../domain/request.js';
import { ProviderRegistry } from '../providers/registry.js';
import type { ResultRepository } from '../storage/result-repository.js';
import { type MinerUDiagnosticSink } from '../observability.js';
import { SharedOperationRegistry } from './shared-operations.js';
export interface ServiceSession {
    readonly header: {
        readonly id: string;
        readonly cwd?: string;
    };
}
export type CredentialResolver = (reference: string, signal: AbortSignal) => Promise<string | undefined>;
export type SubmissionSource = 'cache' | 'shared-operation' | 'provider';
export type ContentStatus = 'complete' | 'partial' | 'not_requested';
export interface ArtifactView {
    readonly kind: string;
    readonly path: string;
    readonly bytes: number;
}
export interface ResultFileView {
    readonly file_id: string;
    readonly name: string;
    readonly artifacts: readonly ArtifactView[];
    readonly artifacts_truncated?: boolean;
    readonly markdown_path?: string;
}
export interface ResultView {
    readonly state: 'completed';
    readonly source: SubmissionSource;
    readonly cache_hit: boolean;
    readonly result_id: string;
    readonly files: readonly ResultFileView[];
    readonly markdown_content?: string;
    readonly content_status: ContentStatus;
    readonly markdown_path?: string;
    readonly read_offset_line?: number;
    readonly manifest_path: string;
    readonly output_limit_chars: number;
}
export interface FailedParseView {
    readonly state: 'failed';
    readonly source: SubmissionSource;
    readonly file_id: string;
    readonly name: string;
    readonly failure: MinerUFailure;
}
export interface BatchParseDocumentView {
    readonly kind: 'batch';
    readonly state: 'completed' | 'partially-completed' | 'failed';
    readonly results: readonly (ResultView | FailedParseView)[];
    readonly output_limit_chars: number;
    readonly content_status?: ContentStatus;
    readonly results_omitted?: boolean;
}
export type ParseDocumentView = ResultView | BatchParseDocumentView;
export interface ProbeView {
    readonly available: boolean;
    readonly provider: MinerUProviderId;
    readonly authentication: 'valid' | 'invalid' | 'not-configured' | 'unknown';
    readonly protocol_version: string;
    readonly server_version?: string;
    readonly queue?: {
        readonly queued?: number;
        readonly processing?: number;
        readonly completed?: number;
        readonly failed?: number;
        readonly max_concurrent?: number;
    };
    readonly diagnostics?: string;
}
export interface MinerUServiceOptions {
    readonly getConfig: () => MinerUConfig;
    readonly providers: ProviderRegistry;
    readonly results: ResultRepository;
    readonly operations: SharedOperationRegistry;
    readonly resolveCredential: CredentialResolver;
    readonly diagnostics?: MinerUDiagnosticSink;
}
export declare function safeStringSlice(str: string, maxLen: number): string;
export declare function truncateAtCleanBoundary(fullText: string, maxChars: number): {
    text: string;
    truncated: boolean;
    resumeLine?: number;
};
export declare function allocateReclaimedShares(lengths: readonly number[], totalBudget: number): number[];
export declare function readMarkdownFile(path: string, totalBytes: number, maxCharsToRead: number): Promise<{
    text: string;
    isCompleteFile: boolean;
}>;
export declare function findMarkdownArtifactPath(value: ResultView): string | undefined;
export declare function formatResultProse(value: ResultView): string;
export declare function formatParseDocumentProse(value: ParseDocumentView): string;
export declare class MinerUService {
    private readonly options;
    constructor(options: MinerUServiceOptions);
    private config;
    private diagnostic;
    private callContext;
    probe(signal: AbortSignal, draft?: ProviderConfig): Promise<ProbeView>;
    private prepare;
    private startBatch;
    private runOperation;
    private fitSingleCandidate;
    private projectSingle;
    private projectBatch;
    private createWaitSignal;
    /** Parse directly to immutable results. No plugin Job is created for this call. */
    parseDocument(session: ServiceSession, input: ParseRequestInput, signal: AbortSignal, pollTimeoutMs?: number | null): Promise<ParseDocumentView>;
}
