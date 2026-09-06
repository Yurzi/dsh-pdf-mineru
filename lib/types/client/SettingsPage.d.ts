import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client';
import { type CredentialClient } from './helpers.js';
export { activateProvider, clearCredential, credentialReference, describeCredential, ensureProviderProfiles, normalizeProviderDefaults, patchActiveProvider, storeCredential, updateConfigSection, type CredentialClient, type CredentialView, } from './helpers.js';
export interface MineruSettingsInjected {
    readonly rpc: ClientConnectionRpc;
    readonly credentials: CredentialClient;
}
type SettingsPageProps = PropsRuntime<'settings.section'> & PropsLocale<'dsh-pdf-mineru'> & MineruSettingsInjected;
export declare function SettingsPage({ rpc, credentials, t }: SettingsPageProps): import("react").JSX.Element;
