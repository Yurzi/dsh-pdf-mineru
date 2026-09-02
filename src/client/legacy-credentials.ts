import type { RpcResult } from '@deepseek-ai/dsh-client-connection/client'
import type { CredentialClient, CredentialView } from './SettingsPage.js'

/** DSH 0.1.1-rc.2 connection.api.credentials request/response contract. */
export interface LegacyCredentialClient {
  describe(payload: { refs: string[] }): Promise<{ result: RpcResult<{ credentials: Readonly<Record<string, CredentialView>> }> }>
  set(payload: { ref: string; value: string }): Promise<{ result: RpcResult<unknown> }>
  unset(payload: { ref: string }): Promise<{ result: RpcResult<unknown> }>
}

/** Normalize the old envelope once at the boundary; never retry credential writes. */
export function adaptLegacyCredentials(legacy: LegacyCredentialClient): CredentialClient {
  return {
    async describe(refs) {
      const { result } = await legacy.describe({ refs })
      return result.ok ? { ok: true, value: result.value.credentials } : result
    },
    async set(ref, value) {
      const { result } = await legacy.set({ ref, value })
      return result.ok ? { ok: true, value: undefined } : result
    },
    async unset(ref) {
      const { result } = await legacy.unset({ ref })
      return result.ok ? { ok: true, value: undefined } : result
    },
  }
}
