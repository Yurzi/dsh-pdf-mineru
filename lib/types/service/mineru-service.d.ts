import type { MinerUConfig, ProviderConfig } from '../config.js';
import type { MinerUProviderId } from '../domain/errors.js';
import type { MinerUResultId } from '../domain/ids.js';
import type { ParseRequestInput } from '../domain/request.js';
import { ProviderRegistry } from '../providers/registry.js';
import type { ResultRepository } from '../storage/result-repository.js';
import type { StorageAccessGate } from '../storage/access-gate.js';
import { type MinerUDiagnosticSink } from '../observability.js';
import { SharedOperationRegistry } from './shared-operations.js';
import type { ParseSummaryView, ResultView } from './result-presenter.js';
export * from './result-presenter.js';
/** Invocation-local progress only; never carries provider refs, paths or credentials. */
export type ParseProgress = 'preparing' | 'waiting-for-parse' | 'reading-result' | 'summarizing';
export type ParseProgressListener = (phase: ParseProgress) => void;
export interface ServiceSession {
    readonly header: {
        readonly id: string;
        readonly cwd?: string;
    };
}
export type CredentialResolver = (reference: string, signal: AbortSignal) => Promise<string | undefined>;
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
    readonly accessGate?: StorageAccessGate;
}
export declare class MinerUService {
    private readonly options;
    constructor(options: MinerUServiceOptions);
    private config;
    private diagnostic;
    private callContext;
    probe(signal: AbortSignal, draft?: ProviderConfig): Promise<ProbeView>;
    private prepare;
    private runOperation;
    private runOperationCore;
    private fitSingleCandidate;
    private projectSingle;
    private createWaitSignal;
    /** Ensure publication and return a bounded synopsis, never a body projection. */
    ensureParsed(session: ServiceSession, input: ParseRequestInput, signal: AbortSignal, onProgress?: ParseProgressListener): Promise<ParseSummaryView>;
    /** Local original-page verification; never invokes a Provider or persists a source. */
    previewPage(session: ServiceSession, input: {
        file_path: string;
        page: number;
        expectedSha256?: string;
    }, signal: AbortSignal): Promise<{
        result_id: MinerUResultId;
        file_id: import("../domain/ids.js").MinerUFileId;
        output_limit_chars: number;
        renderer: "poppler" | "pdfjs";
        name: string;
        page: number;
        page_count: number;
        sha256: string;
        data: Uint8Array;
        media_type: "image/png";
        width?: number;
        height?: number;
    }>;
    /** Read selected content from a published result. */
    parseDocument(session: ServiceSession, input: ParseRequestInput, signal: AbortSignal, pollTimeoutMs?: number | null): Promise<ResultView>;
    private projectSummary;
    /** Shared parse/publication path. Repository integrity checks remain mandatory. */
    private resolveParsedResult;
}
