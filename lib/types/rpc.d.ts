/**
 * rpc.ts — host-side RPC handler for MinerU config CRUD and draft probe.
 *
 * Endpoints (on the `/dsh-pdf-mineru-api` channel, loopback authority):
 *   - `mineru/config.get`  payload: {} → { config: MinerUConfig }
 *   - `mineru/config.set`  payload: { config: unknown } → { config: MinerUConfig }
 *   - `mineru/probe`       payload: { provider?: unknown } → ProbeView
 *
 * Security:
 *   - Authority: strictly 'loopback'
 *   - Credential values and tokens are never returned or leaked in responses/errors.
 *   - Errors sanitized via sanitizeDiagnostic and mapped to allowlisted actionable error codes.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection';
import type { MinerUConfig } from './config.js';
import type { ProbeView } from './service/mineru-service.js';
import type { StorageMaintenanceService } from './storage/maintenance-service.js';
export interface MineruRpcDeps {
    readonly getConfig: () => MinerUConfig;
    readonly setConfig: (value: unknown) => Promise<MinerUConfig>;
    readonly probe: (providerDraft: unknown | undefined, signal: AbortSignal) => Promise<ProbeView>;
    readonly maintenance: Pick<StorageMaintenanceService, 'getStatistics' | 'scanIntegrity' | 'listQuarantine' | 'cleanupQuarantine' | 'gcDryRun' | 'clearCache'>;
}
export type RpcResult<T> = ConnectionRpcResult<T>;
export declare const RPC_CHANNEL = "/dsh-pdf-mineru-api";
export declare function mapRpcError(err: unknown): {
    code: string;
    message: string;
};
export declare function registerRpc(ctx: Context, deps: MineruRpcDeps): () => void | Promise<void>;
