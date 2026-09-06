import type { MinerUConfig, ProviderConfig } from '../config.js';
import type { MinerUProviderId } from '../domain/errors.js';
import type { ParseRequestInput } from '../domain/request.js';
import { ProviderRegistry } from '../providers/registry.js';
import type { ResultRepository } from '../storage/result-repository.js';
import type { StorageAccessGate } from '../storage/access-gate.js';
import { type MinerUDiagnosticSink } from '../observability.js';
import { SharedOperationRegistry } from './shared-operations.js';
import type { ParseSummaryView, ResultView } from './result-presenter.js';
export * from './result-presenter.js';
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
    ensureParsed(session: ServiceSession, input: ParseRequestInput, signal: AbortSignal): Promise<ParseSummaryView>;
    /** Read selected content from a published result. */
    parseDocument(session: ServiceSession, input: ParseRequestInput, signal: AbortSignal, pollTimeoutMs?: number | null): Promise<ResultView>;
    private projectSummary;
    /** Shared parse/publication path. Repository integrity checks remain mandatory. */
    private resolveParsedResult;
}
