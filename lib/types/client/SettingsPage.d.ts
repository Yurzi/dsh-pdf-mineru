import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { ClientConnectionRpc, RpcResult } from '@deepseek-ai/dsh-client-connection/client';
import type { MinerUConfig, ProviderConfig } from '../config.js';
export interface MineruSettingsInjected {
    readonly rpc: ClientConnectionRpc;
    readonly credentials: CredentialClient;
}
export interface CredentialView {
    readonly configured: boolean;
    readonly source?: string;
    readonly writable: boolean;
}
/** Current `ctx.remote.credentials` face in DSH 0.1.2. */
export interface CredentialClient {
    describe(refs: string[]): Promise<RpcResult<Readonly<Record<string, CredentialView>>>>;
    set(ref: string, value: string): Promise<RpcResult<void>>;
    unset(ref: string): Promise<RpcResult<void>>;
}
type SettingsPageProps = PropsRuntime<'settings.section'> & PropsLocale<'dsh-pdf-mineru'> & MineruSettingsInjected;
export declare function switchProviderType(provider: ProviderConfig, nextType: 'self-hosted-v2' | 'official-v4'): ProviderConfig;
export declare function patchActiveProvider(config: MinerUConfig, patch: Partial<ProviderConfig>): MinerUConfig;
export declare function normalizeProviderDefaults(config: MinerUConfig, provider: ProviderConfig): MinerUConfig;
export declare function updateConfigSection<K extends keyof MinerUConfig>(config: MinerUConfig, section: K, patch: Partial<MinerUConfig[K]>): MinerUConfig;
export declare function credentialReference(provider: ProviderConfig | undefined): string | undefined;
export declare function describeCredential(credentials: CredentialClient, reference: string): Promise<CredentialView>;
export declare function storeCredential(credentials: CredentialClient, reference: string, value: string): Promise<void>;
export declare function clearCredential(credentials: CredentialClient, reference: string): Promise<void>;
export declare function SettingsPage({ rpc, credentials, t }: SettingsPageProps): import("react").JSX.Element;
export {};
