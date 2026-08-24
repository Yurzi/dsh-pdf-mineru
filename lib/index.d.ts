import { Readable } from "node:stream";
import z from "schemastery";
import { Context } from "cordis";
//#region src/domain/ids.d.ts
type Brand<T, Name extends string> = T & {
  readonly __brand: Name;
};
type MinerUJobId = Brand<string, 'MinerUJobId'>;
type MinerUResultId = Brand<string, 'MinerUResultId'>;
type MinerUFileId = Brand<string, 'MinerUFileId'>;
type ProviderConfigId = Brand<string, 'ProviderConfigId'>;
type CacheKey = Brand<string, 'CacheKey'>;
type OperationId = Brand<string, 'OperationId'>;
type SessionId = Brand<string, 'SessionId'>;
declare function assertSafePathSegment(value: string, label: string): string;
declare const asJobId: (value: string) => MinerUJobId;
declare const asResultId: (value: string) => MinerUResultId;
declare const asFileId: (value: string) => MinerUFileId;
declare const asProviderConfigId: (value: string) => ProviderConfigId;
declare const asOperationId: (value: string) => OperationId;
declare function asSessionId(value: string): SessionId;
declare function asCacheKey(value: string): CacheKey;
declare const createJobId: () => MinerUJobId;
declare const createOperationId: () => OperationId;
declare function createFileId(sha256: string, index?: number): MinerUFileId;
declare function resultIdForCacheKey(cacheKey: CacheKey): MinerUResultId;
//#endregion
//#region src/domain/request.d.ts
declare const CANONICAL_PARSE_REQUEST_SCHEMA_VERSION: 1;
declare const CACHE_KEY_SPEC_VERSION: 1;
declare const RESULT_SCHEMA_VERSION: 1;
declare const ARTIFACT_KINDS: readonly ["markdown", "layout", "model-output", "content-list", "images"];
type ArtifactKind = typeof ARTIFACT_KINDS[number];
type MinerUModel = 'pipeline' | 'vlm';
type ParseMethod = 'auto' | 'txt' | 'ocr';
interface ParseSemantics {
  readonly model: MinerUModel;
  readonly ocr: boolean;
  /** Preserves the self-hosted legacy txt/auto distinction in the cache key. */
  readonly parseMethod: ParseMethod;
  readonly language: string;
  readonly formula: boolean;
  readonly table: boolean;
  readonly pages?: string;
}
interface CanonicalSourceFile {
  readonly fileId: MinerUFileId;
  readonly name: string;
  readonly bytes: number;
  readonly sha256: string;
}
interface CanonicalParseRequest {
  readonly schemaVersion: typeof CANONICAL_PARSE_REQUEST_SCHEMA_VERSION;
  readonly files: readonly CanonicalSourceFile[];
  readonly semantics: ParseSemantics;
  readonly requiredArtifacts: readonly ArtifactKind[];
}
interface PreparedSourceFile extends CanonicalSourceFile {
  /** Ephemeral execution input. This field is never persisted. */
  readonly path: string;
  readonly fingerprint: {
    readonly size: number;
    readonly mtimeMs: number;
    readonly device: number;
    readonly inode: number;
  };
}
interface PreparedParseRequest {
  readonly request: CanonicalParseRequest;
  readonly sources: readonly PreparedSourceFile[];
}
interface ParseRequestInput {
  readonly file_paths?: readonly string[];
  /** Compatibility alias through the next major release. */
  readonly file_path?: string;
  readonly model?: MinerUModel;
  readonly ocr?: boolean;
  readonly language?: string;
  readonly formula?: boolean;
  readonly table?: boolean;
  readonly pages?: string;
  readonly artifacts?: readonly ArtifactKind[];
  readonly backend?: string;
  readonly parse_method?: ParseMethod;
  readonly lang_list?: readonly string[];
  readonly formula_enable?: boolean;
  readonly table_enable?: boolean;
  readonly return_middle_json?: boolean;
  readonly return_model_output?: boolean;
  readonly return_content_list?: boolean;
  readonly return_images?: boolean;
  readonly start_page_id?: number;
  readonly end_page_id?: number;
}
interface ParseDefaults {
  readonly model: MinerUModel;
  readonly ocr: boolean;
  readonly parseMethod: ParseMethod;
  readonly language: string;
  readonly formula: boolean;
  readonly table: boolean;
  readonly artifacts: readonly ArtifactKind[];
}
declare function normalizeArtifactKinds(kinds: readonly ArtifactKind[]): readonly ArtifactKind[];
//#endregion
//#region src/config.d.ts
interface SelfHostedV2Config {
  readonly id: ProviderConfigId;
  readonly type: 'self-hosted-v2';
  readonly baseURL: string;
  readonly apiKeyEnv?: string;
  readonly modelMap: Readonly<Record<MinerUModel, string>>;
  readonly configuredVersion?: string;
  readonly allowInsecureHttp: boolean;
}
interface OfficialV4Config {
  readonly id: ProviderConfigId;
  readonly type: 'official-v4';
  readonly baseURL: string;
  readonly apiKeyEnv: string;
  readonly models: readonly MinerUModel[];
  readonly configuredVersion: 'v4';
}
type ProviderConfig = SelfHostedV2Config | OfficialV4Config;
interface StorageConfig {
  readonly storageRoot: string;
  readonly cacheEnabled: boolean;
  readonly retainSources: false;
  readonly stagingTtlMs: number;
}
interface PollingConfig {
  readonly pollIntervalMs: number;
  readonly pollTimeoutMs: number;
  readonly requestTimeoutMs: number;
  readonly operationTimeoutMs: number;
}
interface OutputConfig {
  readonly maxInlineChars: number;
}
interface SecurityLimits {
  readonly maxFilesPerRequest: number;
  readonly maxFileBytes: number;
  readonly maxApiResponseBytes: number;
  readonly maxZipDownloadBytes: number;
  readonly maxZipEntries: number;
  readonly maxZipEntryBytes: number;
  readonly maxZipTotalBytes: number;
  readonly maxZipCompressionRatio: number;
}
interface MinerUConfig {
  readonly schemaVersion: 1;
  readonly activeProvider: ProviderConfigId;
  readonly providers: readonly ProviderConfig[];
  readonly defaults: ParseDefaults;
  readonly storage: StorageConfig;
  readonly polling: PollingConfig;
  readonly output: OutputConfig;
  readonly limits: SecurityLimits;
}
interface LegacyMinerUConfig {
  readonly baseURL?: string;
  readonly apiKeyEnv?: string;
  readonly defaultBackend?: string;
  readonly defaultParseMethod?: ParseMethod;
  readonly defaultLang?: string;
  readonly pollIntervalMs?: number;
  readonly pollTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly maxMdOutputChars?: number;
}
declare function defaultMinerUConfig(): MinerUConfig;
declare function migrateConfig(value: unknown): MinerUConfig;
declare function providerById(config: MinerUConfig, id: ProviderConfigId): ProviderConfig | undefined;
//#endregion
//#region src/domain/errors.d.ts
type MinerUProviderId = 'self-hosted-v2' | 'official-v4';
type MinerUErrorCode = 'INVALID_REQUEST' | 'FILE_NOT_FOUND' | 'FILE_TOO_LARGE' | 'UNSUPPORTED_OPTION' | 'CREDENTIAL_MISSING' | 'AUTHENTICATION_FAILED' | 'PROVIDER_UNAVAILABLE' | 'PROVIDER_CONFIG_MISSING' | 'PROVIDER_RATE_LIMITED' | 'PROVIDER_QUOTA_EXHAUSTED' | 'UPLOAD_FAILED' | 'REMOTE_PARSE_FAILED' | 'RESULT_NOT_READY' | 'RESULT_DOWNLOAD_FAILED' | 'RESULT_ARCHIVE_INVALID' | 'RESULT_TOO_LARGE' | 'CACHE_CORRUPT' | 'CACHE_CONFLICT' | 'CACHE_EVICTED' | 'INTERRUPTED_UPLOAD' | 'POLL_TIMEOUT' | 'CANCELLED' | 'UNAUTHENTICATED_SESSION' | 'JOB_NOT_FOUND' | 'JOB_ACCESS_DENIED' | 'STORAGE_LOCKED';
interface MinerUFailure {
  readonly code: MinerUErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly provider?: MinerUProviderId;
  readonly providerCode?: string;
  readonly traceId?: string;
  readonly fileId?: MinerUFileId;
}
declare class MinerUError extends Error {
  readonly failure: MinerUFailure;
  constructor(failure: MinerUFailure, options?: ErrorOptions);
}
declare function sanitizeDiagnostic(input: string): string;
declare function failure(code: MinerUErrorCode, message: string, retryable?: boolean, details?: Omit<MinerUFailure, 'code' | 'message' | 'retryable'>): MinerUFailure;
declare function toMinerUFailure(error: unknown, fallback?: MinerUErrorCode): MinerUFailure;
declare function throwMinerU(code: MinerUErrorCode, message: string, retryable?: boolean): never;
//#endregion
//#region src/domain/result.d.ts
declare const MINERU_RESULT_MANIFEST_SCHEMA_VERSION: 1;
interface ArtifactRef {
  readonly kind: ArtifactKind | 'manifest';
  readonly relativePath: string;
  readonly mediaType: string;
  readonly bytes: number;
  readonly sha256: string;
}
interface ParsedDocumentManifest {
  readonly fileId: MinerUFileId;
  readonly name: string;
  readonly artifacts: readonly ArtifactRef[];
}
interface ResultProducer {
  readonly providerId: MinerUProviderId;
  readonly providerConfigId: ProviderConfigId;
  readonly compatibilityKey: string;
}
/** A published manifest is one immutable source-file result. */
interface MinerUResultManifest {
  readonly schemaVersion: typeof MINERU_RESULT_MANIFEST_SCHEMA_VERSION;
  readonly id: MinerUResultId;
  readonly cacheKey: CacheKey;
  readonly sourceSha256: string;
  readonly request: CanonicalParseRequest;
  readonly producer: ResultProducer;
  readonly files: readonly [ParsedDocumentManifest];
  readonly createdAt: number;
}
//#endregion
//#region src/providers/provider.d.ts
interface ProviderCapabilities {
  readonly models: readonly MinerUModel[];
  readonly parseMethods: readonly ParseMethod[];
  readonly supportsOcr: boolean;
  readonly supportsLanguage: boolean;
  readonly supportsFormula: boolean;
  readonly supportsTable: boolean;
  readonly supportsPageRanges: boolean;
  readonly supportedArtifacts: readonly ArtifactKind[];
  readonly maxFilesPerSubmission: number;
  readonly maxFileBytes?: number;
  readonly maxPagesPerFile?: number;
}
interface ProviderCallLimits {
  readonly maxApiResponseBytes: number;
  readonly maxZipDownloadBytes: number;
  readonly maxZipEntries: number;
  readonly maxZipEntryBytes: number;
  readonly maxZipTotalBytes: number;
  readonly maxZipCompressionRatio: number;
}
interface ProviderCallContext {
  readonly signal: AbortSignal;
  readonly credential?: string;
  readonly timeoutMs: number;
  readonly limits: ProviderCallLimits;
}
interface ProviderCompatibilityContext {
  readonly configuredVersion?: string;
}
interface ProviderProbeResult {
  readonly available: boolean;
  readonly provider: MinerUProviderId;
  readonly authentication: 'valid' | 'invalid' | 'not-configured' | 'unknown';
  readonly protocolVersion: string;
  readonly serverVersion?: string;
  readonly queue?: {
    readonly queued?: number;
    readonly processing?: number;
    readonly completed?: number;
    readonly failed?: number;
    readonly maxConcurrent?: number;
  };
  readonly diagnostics?: string;
}
interface ProviderSubmittedFile {
  readonly dataId: string;
  readonly fileId: MinerUFileId;
  readonly name: string;
}
type ProviderJobRef = {
  readonly provider: 'self-hosted-v2';
  readonly taskId: string;
  readonly files: readonly ProviderSubmittedFile[];
} | {
  readonly provider: 'official-v4';
  readonly batchId: string;
  readonly files: readonly ProviderSubmittedFile[];
};
interface ProviderSubmission {
  readonly ref: ProviderJobRef;
  readonly state: MinerUJobState;
  readonly files: readonly ProviderFileSnapshot[];
}
interface ProviderFileSnapshot {
  readonly fileId: MinerUFileId;
  readonly state: MinerUFileState;
  readonly rawState?: string;
  readonly progress?: {
    readonly completed: number;
    readonly total: number;
  };
  readonly failure?: MinerUFailure;
}
interface ProviderJobSnapshot {
  readonly state: MinerUJobState;
  readonly files: readonly ProviderFileSnapshot[];
  readonly rawState?: string;
  readonly queuedAhead?: number;
}
type ArtifactInput = Readable | ReadableStream<Uint8Array> | Uint8Array | string;
interface ArtifactWriteOptions {
  readonly mediaType: string;
  readonly relativeName?: string;
  readonly maxBytes?: number;
}
interface TemporaryArtifact {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}
interface ArtifactSink {
  writeArtifact(fileId: MinerUFileId, kind: ArtifactKind, input: ArtifactInput, options: ArtifactWriteOptions): Promise<ArtifactRef>;
  writeTemporary(name: string, input: ArtifactInput, maxBytes: number): Promise<TemporaryArtifact>;
}
interface ProviderCollectedFile {
  readonly fileId: MinerUFileId;
  readonly name: string;
  readonly artifacts: readonly ArtifactRef[];
  readonly failure?: MinerUFailure;
}
interface ProviderCollection {
  readonly files: readonly ProviderCollectedFile[];
}
interface MinerUProvider {
  readonly id: MinerUProviderId;
  readonly capabilities: ProviderCapabilities;
  probe(context: ProviderCallContext): Promise<ProviderProbeResult>;
  compatibilityKey(request: CanonicalParseRequest, context: ProviderCompatibilityContext): Promise<string>;
  submit(request: CanonicalParseRequest, sources: readonly PreparedSourceFile[], context: ProviderCallContext): Promise<ProviderSubmission>;
  inspect(ref: ProviderJobRef, context: ProviderCallContext): Promise<ProviderJobSnapshot>;
  collect(ref: ProviderJobRef, request: CanonicalParseRequest, sink: ArtifactSink, context: ProviderCallContext): Promise<ProviderCollection>;
}
declare function validateProviderCapabilities(request: CanonicalParseRequest, capabilities: ProviderCapabilities): void;
//#endregion
//#region src/domain/job.d.ts
declare const MINERU_JOB_SCHEMA_VERSION: 1;
type MinerUFileState = 'queued' | 'uploading' | 'processing' | 'completed' | 'failed';
type MinerUJobState = MinerUFileState | 'collecting' | 'partially-completed';
type JobResolution = {
  readonly kind: 'cache-hit';
} | {
  readonly kind: 'shared-operation';
  readonly operationId: OperationId;
  readonly ref?: ProviderJobRef;
} | {
  readonly kind: 'provider';
  readonly ref?: ProviderJobRef;
};
interface JobSourceFile {
  readonly fileId: MinerUFileId;
  readonly name: string;
  readonly bytes: number;
  readonly sha256: string;
}
interface MinerUFileStatus {
  readonly fileId: MinerUFileId;
  readonly name: string;
  readonly cacheKey: CacheKey;
  readonly state: MinerUFileState;
  readonly resultId?: MinerUResultId;
  readonly failure?: MinerUFailure;
  readonly progress?: {
    readonly completed: number;
    readonly total: number;
  };
}
interface MinerUJobRecord {
  readonly schemaVersion: typeof MINERU_JOB_SCHEMA_VERSION;
  readonly id: MinerUJobId;
  readonly sessionId: SessionId;
  readonly providerId: MinerUProviderId;
  readonly providerConfigId: ProviderConfigId;
  readonly providerCompatibilityKey: string;
  readonly sourceFiles: readonly JobSourceFile[];
  readonly request: CanonicalParseRequest;
  readonly cacheKey: CacheKey;
  readonly state: MinerUJobState;
  readonly resolution: JobResolution;
  readonly files: readonly MinerUFileStatus[];
  readonly resultId?: MinerUResultId;
  readonly failure?: MinerUFailure;
  readonly createdAt: number;
  readonly updatedAt: number;
}
declare function isTerminalJobState(state: MinerUJobState): boolean;
declare function assertJobTransition(previous: MinerUJobState, next: MinerUJobState): void;
//#endregion
//#region src/providers/self-hosted-v2.d.ts
interface SelfHostedV2ProviderConfig {
  readonly id: ProviderConfigId;
  readonly type: 'self-hosted-v2';
  readonly baseURL: string;
  readonly apiKeyEnv?: string;
  readonly modelMap: Readonly<Partial<Record<MinerUModel, string>>>;
  readonly configuredVersion?: string;
  readonly allowInsecureHttp?: boolean;
}
interface SelfHostedHealthResponse {
  readonly status: 'healthy' | 'unhealthy' | string;
  readonly version?: string;
  readonly protocol_version?: number;
  readonly queued_tasks?: number;
  readonly processing_tasks?: number;
  readonly completed_tasks?: number;
  readonly failed_tasks?: number;
  readonly max_concurrent_requests?: number;
}
interface SelfHostedTaskSubmitResponse {
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
interface SelfHostedFileParseResult {
  readonly md_content?: string | null;
  readonly middle_json?: unknown;
  readonly model_output?: unknown;
  readonly content_list?: unknown;
  readonly images?: Readonly<Record<string, string>> | null;
}
interface SelfHostedTaskResultResponse {
  readonly backend?: string;
  readonly version?: string;
  readonly results?: Readonly<Record<string, SelfHostedFileParseResult>>;
}
declare class SelfHostedV2Provider implements MinerUProvider {
  readonly id: "self-hosted-v2";
  readonly config: SelfHostedV2ProviderConfig;
  readonly capabilities: ProviderCapabilities;
  private readonly parsedBaseUrl;
  constructor(config: SelfHostedV2ProviderConfig);
  compatibilityKey(request: CanonicalParseRequest, context: ProviderCompatibilityContext): Promise<string>;
  probe(context: ProviderCallContext): Promise<ProviderProbeResult>;
  submit(request: CanonicalParseRequest, sources: readonly PreparedSourceFile[], context: ProviderCallContext): Promise<ProviderSubmission>;
  inspect(ref: ProviderJobRef, context: ProviderCallContext): Promise<ProviderJobSnapshot>;
  collect(ref: ProviderJobRef, request: CanonicalParseRequest, sink: ArtifactSink, context: ProviderCallContext): Promise<ProviderCollection>;
  private requestJson;
  private readBoundedResponseBody;
}
//#endregion
//#region src/providers/official-v4.d.ts
declare class OfficialV4Provider implements MinerUProvider {
  readonly id: "official-v4";
  readonly config: OfficialV4Config;
  readonly capabilities: ProviderCapabilities;
  private readonly parsedBaseUrl;
  constructor(config: OfficialV4Config);
  compatibilityKey(request: CanonicalParseRequest, context: ProviderCompatibilityContext): Promise<string>;
  probe(context: ProviderCallContext): Promise<ProviderProbeResult>;
  submit(request: CanonicalParseRequest, sources: readonly PreparedSourceFile[], context: ProviderCallContext): Promise<ProviderSubmission>;
  inspect(ref: ProviderJobRef, context: ProviderCallContext): Promise<ProviderJobSnapshot>;
  collect(ref: ProviderJobRef, request: CanonicalParseRequest, sink: ArtifactSink, context: ProviderCallContext): Promise<ProviderCollection>;
  private requestJson;
  private barePutStream;
  private downloadZipToTemporary;
  private readBoundedResponseBody;
}
//#endregion
//#region src/providers/registry.d.ts
interface ResolvedProvider {
  readonly provider: MinerUProvider;
  readonly config: ProviderConfig;
}
declare class ProviderRegistry {
  private readonly getConfig;
  constructor(getConfig: () => MinerUConfig);
  active(): ResolvedProvider;
  resolve(configId: ProviderConfigId): ResolvedProvider;
  resolveForJob(job: MinerUJobRecord): Promise<ResolvedProvider>;
  create(config: ProviderConfig): MinerUProvider;
}
//#endregion
//#region src/service/shared-operations.d.ts
interface SharedWaiter {
  readonly jobId: MinerUJobId;
  readonly sessionId: SessionId;
  readonly session: {
    readonly header: {
      readonly id: SessionId | string;
    };
  };
}
interface SharedSubmission {
  readonly ref?: ProviderJobRef;
  readonly state: MinerUJobState;
}
interface SharedOutcome {
  readonly state: Extract<MinerUJobState, 'completed' | 'partially-completed' | 'failed'>;
  readonly resultId?: MinerUResultId;
}
declare class SharedOperation {
  readonly cacheKey: CacheKey;
  readonly id: OperationId;
  readonly waiters: Map<MinerUJobId, SharedWaiter>;
  readonly controller: AbortController;
  private readonly submission;
  private readonly outcome;
  private submitted;
  private settled;
  constructor(cacheKey: CacheKey);
  attach(waiter: SharedWaiter): void;
  markSubmitted(value: SharedSubmission): void;
  resolve(value: SharedOutcome): void;
  reject(error: unknown): void;
  waitForSubmission(signal: AbortSignal): Promise<SharedSubmission>;
  waitForOutcome(signal: AbortSignal): Promise<SharedOutcome>;
  abort(reason: unknown): void;
}
declare class SharedOperationRegistry {
  private readonly operations;
  private disposed;
  acquire(cacheKey: CacheKey, timeoutMs: number, runner: (operation: SharedOperation) => Promise<SharedOutcome>): {
    readonly operation: SharedOperation;
    readonly created: boolean;
  };
  get(cacheKey: CacheKey): SharedOperation | undefined;
  activeOperationIds(): ReadonlySet<OperationId>;
  dispose(): void;
}
//#endregion
//#region src/storage/paths.d.ts
declare class StoragePaths {
  readonly root: string;
  constructor(root?: string);
  jobsDir(): string;
  jobDir(sessionId: SessionId | string): string;
  jobFile(sessionId: SessionId | string, jobId: MinerUJobId | string): string;
  jobTempFile(sessionId: SessionId | string, jobId: MinerUJobId | string, token: string): string;
  resultsDir(): string;
  resultDir(cacheKey: CacheKey | string): string;
  manifestFile(cacheKey: CacheKey | string): string;
  filesDir(cacheKey: CacheKey | string): string;
  fileDir(cacheKey: CacheKey | string, fileId: MinerUFileId | string): string;
  stagingDir(operationId?: OperationId | string): string;
  stagingFilesDir(operationId: OperationId | string): string;
  stagingFileDir(operationId: OperationId | string, fileId: MinerUFileId | string): string;
  stagingTempDir(operationId: OperationId | string): string;
  stagingManifestFile(operationId: OperationId | string): string;
  quarantineDir(name?: string): string;
  processLockFile(): string;
  resolveArtifactPath(cacheKey: CacheKey | string, relativePath: string): string;
  resolveStagingArtifactPath(operationId: OperationId | string, relativePath: string): string;
}
//#endregion
//#region src/storage/job-repository.d.ts
interface SessionIdentifier {
  readonly header: {
    readonly id: SessionId | string;
  };
}
declare class JobRepository {
  readonly paths: StoragePaths;
  private readonly mutex;
  constructor(paths: StoragePaths);
  create(session: SessionIdentifier, job: MinerUJobRecord): Promise<MinerUJobRecord>;
  get(session: SessionIdentifier, jobId: MinerUJobId | string): Promise<MinerUJobRecord | undefined>;
  require(session: SessionIdentifier, jobId: MinerUJobId | string): Promise<MinerUJobRecord>;
  update(session: SessionIdentifier, jobId: MinerUJobId | string, mutator: (current: MinerUJobRecord) => MinerUJobRecord | Promise<MinerUJobRecord>): Promise<MinerUJobRecord>;
  list(session: SessionIdentifier): Promise<readonly MinerUJobRecord[]>;
  private atomicWrite;
}
//#endregion
//#region src/storage/result-repository.d.ts
declare class ResultTransaction implements ArtifactSink {
  readonly request: CanonicalParseRequest;
  readonly producer: ResultProducer;
  readonly paths: StoragePaths;
  readonly operationId: OperationId;
  readonly stagingDir: string;
  private readonly sink;
  constructor(operationId: OperationId | string, request: CanonicalParseRequest, producer: ResultProducer, paths: StoragePaths, signal?: AbortSignal, maxArtifactBytes?: number);
  writeArtifact(fileId: MinerUFileId, kind: ArtifactKind, input: ArtifactInput, options: ArtifactWriteOptions): Promise<ArtifactRef>;
  writeTemporary(name: string, input: ArtifactInput, maxBytes: number): Promise<TemporaryArtifact>;
  buildManifest(file: CanonicalSourceFile, artifacts: readonly ArtifactRef[]): MinerUResultManifest;
  abort(): Promise<void>;
}
interface ResultRepositoryOptions {
  readonly maxJsonValidationBytes?: number;
  readonly maxArtifactBytes?: number;
}
declare class ResultRepository {
  readonly paths: StoragePaths;
  private readonly maxJsonValidationBytes;
  private readonly maxArtifactBytes;
  constructor(paths: StoragePaths, options?: ResultRepositoryOptions);
  beginTransaction(operationId: OperationId | string, request: CanonicalParseRequest, producer: ResultProducer, signal?: AbortSignal): ResultTransaction;
  private assertManifestConsistency;
  private verifyArtifact;
  private verifyManifestArtifacts;
  commitTransaction(tx: ResultTransaction, manifest: MinerUResultManifest, signal?: AbortSignal): Promise<{
    resultId: MinerUResultId;
    cacheKey: CacheKey;
    manifest: MinerUResultManifest;
  }>;
  get(cacheKey: CacheKey | string, requiredArtifacts?: readonly ArtifactKind[], signal?: AbortSignal): Promise<MinerUResultManifest | undefined>;
  resolveArtifactAbsolutePath(cacheKey: CacheKey | string, relativePath: string): string;
  manifestAbsolutePath(cacheKey: CacheKey | string): string;
  quarantine(sourcePath: string, reason?: string): Promise<string>;
  cleanupStaging(ttlMs: number, activeOperationIds?: ReadonlySet<OperationId | string>, signal?: AbortSignal): Promise<number>;
}
//#endregion
//#region src/service/mineru-service.d.ts
interface ServiceSession extends SessionIdentifier {
  readonly header: {
    readonly id: SessionId | string;
    readonly cwd?: string;
  };
}
type CredentialResolver = (reference: string, signal: AbortSignal) => Promise<string | undefined>;
type SubmissionSource = 'cache' | 'shared-operation' | 'provider';
interface FileStatusView {
  readonly file_id: string;
  readonly name: string;
  readonly state: string;
  readonly progress?: {
    readonly completed: number;
    readonly total: number;
  };
  readonly failure?: MinerUFailure;
}
interface SubmitView {
  readonly job_id: string;
  readonly state: MinerUJobState;
  readonly source: SubmissionSource;
  readonly provider: MinerUProviderId;
  readonly files: readonly FileStatusView[];
  readonly result_available: boolean;
  readonly failure?: MinerUFailure;
}
interface StatusView extends SubmitView {
  readonly created_at: number;
  readonly updated_at: number;
}
interface ArtifactView {
  readonly kind: string;
  readonly path: string;
  readonly bytes: number;
}
interface ResultFileView {
  readonly file_id: string;
  readonly name: string;
  readonly artifacts: readonly ArtifactView[];
  readonly artifacts_truncated?: boolean;
}
interface ResultView {
  readonly job_id: string;
  readonly state: Extract<MinerUJobState, 'completed' | 'partially-completed'>;
  readonly cache_hit: boolean;
  readonly result_id: string;
  readonly files: readonly ResultFileView[];
  readonly markdown_preview?: string;
  readonly preview_truncated: boolean;
  readonly manifest_path: string;
  readonly output_limit_chars: number;
}
interface ProbeView {
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
type ParseDocumentView = ResultView | (StatusView & {
  readonly poll_timed_out?: true;
});
interface MinerUServiceOptions {
  readonly getConfig: () => MinerUConfig;
  readonly providers: ProviderRegistry;
  readonly jobs: JobRepository;
  readonly results: ResultRepository;
  readonly operations: SharedOperationRegistry;
  readonly resolveCredential: CredentialResolver;
}
declare class MinerUService {
  private readonly options;
  constructor(options: MinerUServiceOptions);
  private config;
  private callContext;
  private legacyBackendModels;
  probe(signal: AbortSignal, draft?: ProviderConfig): Promise<ProbeView>;
  submit(session: ServiceSession, input: ParseRequestInput, signal: AbortSignal): Promise<SubmitView>;
  private newJob;
  private syncSubmission;
  private updateWaiters;
  private snapshotFiles;
  private runOperation;
  status(session: ServiceSession, jobId: string, signal: AbortSignal): Promise<StatusView>;
  private markdownPreview;
  private fitResult;
  result(session: ServiceSession, jobId: string, signal: AbortSignal): Promise<ResultView>;
  private projectResult;
  parseDocument(session: ServiceSession, input: ParseRequestInput, signal: AbortSignal, pollTimeoutMs?: number): Promise<ParseDocumentView>;
}
//#endregion
//#region src/index.d.ts
declare const name = "dsh-pdf-mineru";
declare const inject: string[];
/** Entry schema accepts both the provider config and the legacy flat config. */
declare const Config: z<unknown>;
declare function apply(ctx: Context, entryConfig?: unknown): Promise<() => Promise<void>>;
//#endregion
export { ARTIFACT_KINDS, ArtifactInput, ArtifactKind, ArtifactRef, ArtifactSink, ArtifactView, ArtifactWriteOptions, CACHE_KEY_SPEC_VERSION, CANONICAL_PARSE_REQUEST_SCHEMA_VERSION, CacheKey, CanonicalParseRequest, CanonicalSourceFile, Config, CredentialResolver, FileStatusView, JobResolution, JobSourceFile, LegacyMinerUConfig, MINERU_JOB_SCHEMA_VERSION, MINERU_RESULT_MANIFEST_SCHEMA_VERSION, MinerUConfig, MinerUError, MinerUErrorCode, MinerUFailure, MinerUFileId, MinerUFileState, MinerUFileStatus, MinerUJobId, MinerUJobRecord, MinerUJobState, MinerUModel, MinerUProvider, MinerUProviderId, MinerUResultId, MinerUResultManifest, MinerUService, MinerUServiceOptions, OfficialV4Config, OfficialV4Provider, OperationId, OutputConfig, ParseDefaults, ParseDocumentView, ParseMethod, ParseRequestInput, ParseSemantics, ParsedDocumentManifest, PollingConfig, PreparedParseRequest, PreparedSourceFile, ProbeView, ProviderCallContext, ProviderCallLimits, ProviderCapabilities, ProviderCollectedFile, ProviderCollection, ProviderCompatibilityContext, ProviderConfig, ProviderConfigId, ProviderFileSnapshot, ProviderJobRef, ProviderJobSnapshot, ProviderProbeResult, ProviderSubmission, ProviderSubmittedFile, RESULT_SCHEMA_VERSION, ResultFileView, ResultProducer, ResultView, SecurityLimits, SelfHostedFileParseResult, SelfHostedHealthResponse, SelfHostedTaskResultResponse, SelfHostedTaskSubmitResponse, SelfHostedV2Config, SelfHostedV2Provider, SelfHostedV2ProviderConfig, ServiceSession, SessionId, StatusView, StorageConfig, SubmissionSource, SubmitView, TemporaryArtifact, apply, asCacheKey, asFileId, asJobId, asOperationId, asProviderConfigId, asResultId, asSessionId, assertJobTransition, assertSafePathSegment, createFileId, createJobId, createOperationId, defaultMinerUConfig, failure, inject, isTerminalJobState, migrateConfig, name, normalizeArtifactKinds, providerById, resultIdForCacheKey, sanitizeDiagnostic, throwMinerU, toMinerUFailure, validateProviderCapabilities };