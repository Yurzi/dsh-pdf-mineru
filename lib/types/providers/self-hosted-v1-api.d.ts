/**
 * self-hosted-v1-api.ts — MinerU 4.x self-hosted "V1 API" protocol adapter.
 *
 * Wire contract (see scripts/http_api_example.sh in opendatalab/MinerU):
 *   POST /v1/uploads                  create an upload session (deduplicated files are already completed)
 *   PUT  {upload_url}                 stream the raw bytes with the service-provided upload headers
 *   POST /v1/uploads/{id}/complete    finalize the upload and obtain the file id
 *   POST /v1/parse/jobs               submit one parse job covering every uploaded file
 *   GET  /v1/parse/jobs/{job_id}      poll job/file status and per-file output references
 *   GET  /v1/files/{file_id}/content  download a parse output (the result archive)
 *
 * A job requests the `zip` output format, which is the complete MinerU output package
 * (`markdown.md`, `middle_json.json`, `structured_content.json`, `model_output.json`,
 * `images/*`). Collection therefore reuses the shared bounded ZIP extractor and only
 * canonicalizes the two documents whose MinerU 4.x shape differs from the plugin's
 * canonical artifact shape (layout page list and structured content).
 */
import type { MinerUFileState, MinerUJobState } from '../domain/job.js';
import type { CanonicalParseRequest, MinerUModel, PreparedSourceFile } from '../domain/request.js';
import type { ProviderHttpClient } from './http-client.js';
import { type ArtifactSink, type ProviderCallContext, type ProviderCollection, type ProviderJobRef, type ProviderJobSnapshot, type ProviderProbeResult, type ProviderRetryOptions, type ProviderSubmission, type ProviderSubmittedFile } from './provider.js';
/** The only output format the plugin consumes; it carries every canonical artifact. */
export declare const SELF_HOSTED_V1_ARCHIVE_FORMAT = "zip";
/** Tiers advertised by the MinerU V1 API; other modelMap values fall back to the server default. */
export declare const SELF_HOSTED_V1_TIERS: ReadonlySet<string>;
/**
 * Effective V1 parse tier: an explicitly configured tier wins; otherwise a modelMap value that
 * names a tier is honoured, and anything else keeps the server default tier. Shared with the
 * provider compatibility key so the cached result identity matches the submitted request.
 */
export declare function resolveSelfHostedTier(tier: string | undefined, modelMap: Readonly<Partial<Record<MinerUModel, string>>>, model: MinerUModel): string | undefined;
export interface SelfHostedV1HealthResponse {
    readonly status?: string;
    readonly version?: string;
    readonly features?: {
        readonly output_formats?: readonly string[];
        readonly sources?: readonly string[];
    };
}
export interface SelfHostedV1UsageResponse {
    readonly limits?: {
        readonly max_concurrent_jobs?: number;
        readonly max_files_per_job?: number;
    };
}
export interface SelfHostedV1UploadResponse {
    readonly id?: string;
    readonly status?: string;
    readonly upload_url?: string | null;
    readonly upload_method?: string | null;
    readonly upload_headers?: Readonly<Record<string, string>> | null;
    readonly file?: {
        readonly id?: string;
    } | null;
}
export interface SelfHostedV1OutputFileRef {
    readonly file_id?: string;
    readonly bytes?: number;
}
export interface SelfHostedV1JobFile {
    readonly file_id?: string | null;
    readonly name?: string;
    readonly page_range?: string;
    readonly status?: string;
    readonly output_files?: Readonly<Record<string, SelfHostedV1OutputFileRef | null>> | null;
    readonly error?: {
        readonly code?: string | null;
        readonly message?: string;
    } | null;
}
export interface SelfHostedV1JobResponse {
    readonly job_id?: string;
    readonly status?: string;
    readonly files?: readonly SelfHostedV1JobFile[];
    readonly progress?: {
        readonly completed?: number;
        readonly failed?: number;
        readonly total?: number;
    } | null;
}
export interface SelfHostedV1ApiAdapterOptions {
    readonly client: ProviderHttpClient;
    readonly baseUrl: URL;
    readonly retry: ProviderRetryOptions;
    readonly modelMap: Readonly<Partial<Record<MinerUModel, string>>>;
    /** Explicit V1 parse tier; absent keeps the upstream server default. */
    readonly tier?: string;
}
export declare function mimeTypeForName(name: string): string;
/** Same scheme, host, and effective port; the only target that may receive the API key. */
export declare function isSameOriginUrl(target: URL, baseUrl: URL): boolean;
/** True when an HTTPS endpoint points the byte upload at a cleartext origin elsewhere. */
export declare function isInsecureCrossOriginUpload(target: URL, baseUrl: URL): boolean;
/**
 * Maps a MinerU V1 job status to the plugin's aggregate job state.
 * `canceled` has no dedicated plugin state and is reported as a failed job.
 */
export declare function mapSelfHostedV1JobState(rawStatus: unknown): MinerUJobState;
/** Maps a MinerU V1 per-file status to the plugin's file state. */
export declare function mapSelfHostedV1FileState(rawStatus: unknown): MinerUFileState;
/**
 * Matches a submitted file to its upstream job entry. The V1 API echoes job files in
 * submission order, so the positional entry wins when its name agrees; otherwise a
 * unique name match is used.
 */
export declare function matchV1JobFile(jobFiles: readonly SelfHostedV1JobFile[], file: ProviderSubmittedFile, index: number): SelfHostedV1JobFile | undefined;
/**
 * Positive shape check for the MinerU 4.x health document. The V1 schema always carries a
 * `version` and never the legacy `protocol_version`/queue counters, so a generic proxy or an
 * earlier self-hosted server answering 200 with some other JSON object is not mistaken for V1.
 */
export declare function isSelfHostedV1Health(value: unknown): value is SelfHostedV1HealthResponse;
/**
 * Converts the MinerU 4.x `structured_content.json` document into the plugin's canonical
 * content-list array: the page container supplies each block's `page_idx`, MinerU title
 * types map onto the canonical heading fields, and image/table references map onto the
 * canonical caption and image-path fields. Unknown fields are preserved as-is.
 */
export declare function canonicalizeStructuredContent(parsed: unknown): readonly unknown[] | undefined;
/**
 * The plugin's canonical layout document exposes the ordered page list as `pdf_info[]`.
 * MinerU 4.x publishes the same list as `pages[]`; keep the upstream document and add the
 * canonical alias so physical page bounds stay verifiable.
 */
export declare function canonicalizeLayoutDocument(parsed: unknown): Record<string, unknown> | undefined;
export declare class SelfHostedV1ApiAdapter {
    private readonly options;
    constructor(options: SelfHostedV1ApiAdapterOptions);
    /** Cheap protocol probe: answers whether the configured endpoint speaks the V1 API. */
    health(context: ProviderCallContext): Promise<SelfHostedV1HealthResponse>;
    probe(context: ProviderCallContext, health: SelfHostedV1HealthResponse): Promise<ProviderProbeResult>;
    submit(request: CanonicalParseRequest, sources: readonly PreparedSourceFile[], context: ProviderCallContext): Promise<ProviderSubmission>;
    inspect(ref: ProviderJobRef, context: ProviderCallContext): Promise<ProviderJobSnapshot>;
    collect(ref: ProviderJobRef, request: CanonicalParseRequest, sink: ArtifactSink, context: ProviderCallContext): Promise<ProviderCollection>;
    /**
     * Resolves the V1 tier for one request; shared with the compatibility key so both agree.
     */
    private resolveTier;
    private snapshotFromJob;
    private uploadSource;
    private requireFileId;
    /**
     * Streams source bytes to the service-provided upload URL. The API key is attached only
     * when the target is same-origin with the configured endpoint; service-provided upload
     * headers are otherwise preserved verbatim. PUT is idempotent, so transient failures retry
     * with a freshly opened source file.
     */
    private putUploadBytes;
    private resolveUploadUrl;
    private isSameOrigin;
    /** Downloads the result archive of a completed file into a bounded staging temporary file. */
    private downloadResultArchive;
    private requestJson;
}
