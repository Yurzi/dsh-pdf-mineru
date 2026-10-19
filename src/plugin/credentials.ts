import type { Context } from '@deepseek-ai/cordis'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialResolver } from '../service/parse-service.js'

/** Stored DSH credentials win; process.env is read only on hosts without the credential service. */
export function credentialResolver(ctx: Context): CredentialResolver {
  return async (reference, signal) => {
    signal.throwIfAborted()
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const resolved = await credentials.resolve(reference as CredentialRef)
      signal.throwIfAborted()
      return resolved?.value
    }
    return process.env[reference] || undefined
  }
}
