import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { SettingsPage, type MineruSettingsInjected } from './SettingsPage.js'
import { en, NS, zh, type MineruKey } from './locales.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-pdf-mineru': MineruKey
  }
}

export const inject = ['slots', 'locale', 'connection', 'remote', 'remote.credentials']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-pdf-mineru: dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle | undefined
  if (connection === undefined) throw new Error('dsh-pdf-mineru: connection service is unavailable')
  const injected = (): MineruSettingsInjected => ({ rpc: connection.rpc, credentials: ctx.remote.credentials })

  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config',
    key: 'dsh-pdf-mineru',
    locale: NS,
    inject: injected,
  }, SettingsPage))
}
