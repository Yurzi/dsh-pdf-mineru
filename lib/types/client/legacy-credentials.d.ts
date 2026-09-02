import type { RpcResult } from '@deepseek-ai/dsh-client-connection/client';
import type { CredentialClient, CredentialView } from './SettingsPage.js';
/** DSH 0.1.1-rc.2 connection.api.credentials request/response contract. */
export interface LegacyCredentialClient {
    describe(payload: {
        refs: string[];
    }): Promise<{
        result: RpcResult<{
            credentials: Readonly<Record<string, CredentialView>>;
        }>;
    }>;
    set(payload: {
        ref: string;
        value: string;
    }): Promise<{
        result: RpcResult<unknown>;
    }>;
    unset(payload: {
        ref: string;
    }): Promise<{
        result: RpcResult<unknown>;
    }>;
}
/** Normalize the old envelope once at the boundary; never retry credential writes. */
export declare function adaptLegacyCredentials(legacy: LegacyCredentialClient): CredentialClient;
