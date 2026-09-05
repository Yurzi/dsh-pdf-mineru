import type { CanonicalParseRequest, PreparedSourceFile } from '../domain/request.js';
import { type ArtifactSink, type MinerUProvider, type ProviderCallContext, type ProviderCapabilities, type ProviderCollection, type ProviderCompatibilityContext, type ProviderJobRef, type ProviderJobSnapshot, type ProviderOptions, type ProviderProbeResult, type ProviderSubmission } from './provider.js';
import type { OfficialV4Config } from '../config.js';
export declare class OfficialV4Provider implements MinerUProvider {
    readonly id: "official-v4";
    readonly config: OfficialV4Config;
    readonly capabilities: ProviderCapabilities;
    private readonly parsedBaseUrl;
    private readonly retryOptions;
    private readonly client;
    constructor(config: OfficialV4Config, options?: ProviderOptions);
    compatibilityKey(request: CanonicalParseRequest, context: ProviderCompatibilityContext): Promise<string>;
    probe(context: ProviderCallContext): Promise<ProviderProbeResult>;
    submit(request: CanonicalParseRequest, sources: readonly PreparedSourceFile[], context: ProviderCallContext): Promise<ProviderSubmission>;
    inspect(ref: ProviderJobRef, context: ProviderCallContext): Promise<ProviderJobSnapshot>;
    collect(ref: ProviderJobRef, request: CanonicalParseRequest, sink: ArtifactSink, context: ProviderCallContext): Promise<ProviderCollection>;
    private requestJson;
    private barePutStream;
    private downloadZipToTemporary;
}
