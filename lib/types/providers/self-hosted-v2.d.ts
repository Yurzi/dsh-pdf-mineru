import { type ProviderConfigId } from '../domain/ids.js';
import type { CanonicalParseRequest, MinerUModel, PreparedSourceFile } from '../domain/request.js';
import { type ArtifactSink, type MinerUProvider, type ProviderCallContext, type ProviderCapabilities, type ProviderCollection, type ProviderCompatibilityContext, type ProviderJobRef, type ProviderJobSnapshot, type ProviderOptions, type ProviderProbeResult, type ProviderSubmission } from './provider.js';
export interface SelfHostedV2ProviderConfig {
    readonly id: ProviderConfigId;
    readonly type: 'self-hosted-v2';
    readonly baseURL: string;
    readonly apiKeyEnv?: string;
    readonly modelMap: Readonly<Partial<Record<MinerUModel, string>>>;
    readonly configuredVersion?: string;
    readonly allowInsecureHttp?: boolean;
}
export interface SelfHostedHealthResponse {
    readonly status: 'healthy' | 'unhealthy' | string;
    readonly version?: string;
    readonly protocol_version?: number;
    readonly queued_tasks?: number;
    readonly processing_tasks?: number;
    readonly completed_tasks?: number;
    readonly failed_tasks?: number;
    readonly max_concurrent_requests?: number;
}
export interface SelfHostedTaskSubmitResponse {
    readonly task_id: string;
    readonly status: string;
    readonly backend?: string;
    readonly file_names?: readonly string[];
    readonly created_at?: string | null;
    readonly started_at?: string | null;
    readonly completed_at?: string | null;
    readonly error?: string | null;
    readonly status_url?: string;
    readonly result_url?: string;
    readonly queued_ahead?: number;
}
export interface SelfHostedFileParseResult {
    readonly md_content?: string | null;
    readonly middle_json?: unknown;
    readonly model_output?: unknown;
    readonly content_list?: unknown;
    readonly images?: Readonly<Record<string, string>> | null;
}
export interface SelfHostedTaskResultResponse {
    readonly backend?: string;
    readonly version?: string;
    readonly results?: Readonly<Record<string, SelfHostedFileParseResult>>;
}
export declare class SelfHostedV2Provider implements MinerUProvider {
    readonly id: "self-hosted-v2";
    readonly config: SelfHostedV2ProviderConfig;
    readonly capabilities: ProviderCapabilities;
    private readonly parsedBaseUrl;
    private readonly retryOptions;
    constructor(config: SelfHostedV2ProviderConfig, options?: ProviderOptions);
    compatibilityKey(request: CanonicalParseRequest, context: ProviderCompatibilityContext): Promise<string>;
    probe(context: ProviderCallContext): Promise<ProviderProbeResult>;
    submit(request: CanonicalParseRequest, sources: readonly PreparedSourceFile[], context: ProviderCallContext): Promise<ProviderSubmission>;
    inspect(ref: ProviderJobRef, context: ProviderCallContext): Promise<ProviderJobSnapshot>;
    collect(ref: ProviderJobRef, request: CanonicalParseRequest, sink: ArtifactSink, context: ProviderCallContext): Promise<ProviderCollection>;
    private requestJson;
}
