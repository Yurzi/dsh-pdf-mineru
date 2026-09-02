import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { ClientConnectionRpc, RpcResult } from '@deepseek-ai/dsh-client-connection/client';
import { type MinerUConfig, type ProviderConfig } from '../config.js';
export interface MineruSettingsInjected {
    readonly rpc: ClientConnectionRpc;
    readonly credentials: CredentialClient;
}
export interface CredentialView {
    readonly configured: boolean;
    readonly source?: string;
    readonly writable: boolean;
}
/** Normalized face: native Remote on newer DSH, adapter on RC2. */
export interface CredentialClient {
    describe(refs: string[]): Promise<RpcResult<Readonly<Record<string, CredentialView>>>>;
    set(ref: string, value: string): Promise<RpcResult<void>>;
    unset(ref: string): Promise<RpcResult<void>>;
}
export type SettingsPageProps = PropsRuntime & PropsLocale<'dsh-pdf-mineru'> & MineruSettingsInjected & {
    /** The parent plugin card already supplies the page title. */
    readonly embedded?: boolean;
};
export declare function ensureProviderProfiles(config: MinerUConfig): MinerUConfig;
export declare function patchActiveProvider(config: MinerUConfig, patch: Partial<ProviderConfig>): MinerUConfig;
export declare function normalizeProviderDefaults(config: MinerUConfig, provider: ProviderConfig): MinerUConfig;
export declare function activateProvider(config: MinerUConfig, providerId: string): MinerUConfig;
export declare function updateConfigSection<K extends keyof MinerUConfig>(config: MinerUConfig, section: K, patch: Partial<MinerUConfig[K]>): MinerUConfig;
export declare function credentialReference(provider: ProviderConfig | undefined): string | undefined;
export declare function describeCredential(credentials: CredentialClient, reference: string): Promise<CredentialView>;
export declare function storeCredential(credentials: CredentialClient, reference: string, value: string): Promise<void>;
export declare function clearCredential(credentials: CredentialClient, reference: string): Promise<void>;
export declare function SettingsPage({ rpc, credentials, t, embedded }: SettingsPageProps): import("react").JSX.Element;
