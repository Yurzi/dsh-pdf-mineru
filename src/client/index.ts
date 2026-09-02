import type { Context as CordisContext } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { SettingsPage, type CredentialClient, type MineruSettingsInjected } from './SettingsPage.js'
import { SettingsCard } from './SettingsCard.js'
import { en, NS, zh, type MineruKey } from './locales.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-pdf-mineru': MineruKey
  }
}

type SlotOptions = {
  name: string
  id?: string
  key?: string
  order?: number
  label?: () => string
  locale?: string
  inject: () => unknown
}

type ClientContext = CordisContext & {
  readonly locale: {
    register(ns: string, dictionaries: Record<string, Record<string, string>>): () => void
    bind(ns: string): (key: MineruKey) => string
  }
  readonly slots: {
    inject(slotName: string, factory: () => unknown): void
    register(options: SlotOptions, component: unknown): () => void
    spec?(slotName: string): unknown
  }
  readonly remote: { readonly credentials: CredentialClient }
}

export const inject = ['slots', 'locale', 'connection', 'remote', 'remote.credentials']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-pdf-mineru: dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle | undefined
  if (connection === undefined) throw new Error('dsh-pdf-mineru: connection service is unavailable')
  const t = ctx.locale.bind(NS)
  const injected = (): MineruSettingsInjected => ({ rpc: connection.rpc, credentials: ctx.remote.credentials })

  if (ctx.slots.spec?.('settings.plugin.item') !== undefined) {
    ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
      name: 'settings.plugin.item',
      key: NS,
      locale: NS,
      inject: injected,
    }, SettingsCard))
    return
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: NS,
    order: 40,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, SettingsPage))
}
