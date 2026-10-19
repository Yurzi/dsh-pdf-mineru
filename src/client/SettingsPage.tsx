import { useState, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { Button, SegmentedTabs, type SegmentedTab } from '@deepseek-ai/dsh-client-ui-primitives'
import { ActionBar } from './components/ActionBar.js'
import { ConnectionTab } from './components/ConnectionTab.js'
import { StorageTab } from './components/StorageTab.js'
import type { CredentialClient } from './helpers.js'
import { SettingsContext } from './settings-context.js'
import { useSettingsController, type ReadySettings } from './settings-controller.js'
import css from './SettingsPage.module.css'

export interface MineruSettingsInjected {
  readonly rpc: ClientConnectionRpc
  readonly credentials: CredentialClient
}

export type SettingsPageProps = PropsRuntime<'plugins.bundle.config'> &
  PropsLocale<'dsh-pdf-mineru'> &
  MineruSettingsInjected

type TabKey = 'connection' | 'storage'

export function SettingsPage({ rpc, credentials, t }: SettingsPageProps): ReactNode {
  const settings = useSettingsController({ rpc, credentials })
  const [tab, setTab] = useState<TabKey>('connection')

  if (settings.load.kind === 'failed') {
    return (
      <div className={css.page} data-plugin-detail="dsh-pdf-mineru">
        <div className={css.notice} role="alert">
          <p className={css.noticeText}>{t('page.loadFailed', { message: settings.load.message })}</p>
          <Button variant="outline" size="sm" onClick={() => { void settings.reload() }}>{t('action.retry')}</Button>
        </div>
      </div>
    )
  }
  // A reload keeps the current page mounted; only the first load shows a placeholder.
  if (settings.state === null || settings.provider === undefined) {
    return (
      <div className={css.page} data-plugin-detail="dsh-pdf-mineru">
        <p className={css.noticeText} role="status">{t('page.loading')}</p>
      </div>
    )
  }

  const tabs: readonly [SegmentedTab<TabKey>, SegmentedTab<TabKey>] = [
    { value: 'connection', label: t('tab.connection'), id: 'mineru-tab-connection', panelId: 'mineru-panel-connection' },
    { value: 'storage', label: t('tab.storage'), id: 'mineru-tab-storage', panelId: 'mineru-panel-storage' },
  ]
  return (
    <SettingsContext.Provider value={{ settings: settings as ReadySettings, rpc, t }}>
      <div className={css.page} data-plugin-detail="dsh-pdf-mineru">
        <SegmentedTabs items={tabs} value={tab} onChange={setTab} label={t('page.tabs')} />
        {/* Both panels stay mounted so per-tab view state survives switching; drafts live in the controller. */}
        <div id="mineru-panel-connection" role="tabpanel" aria-labelledby="mineru-tab-connection" className={css.panel} hidden={tab !== 'connection'}>
          <ConnectionTab />
        </div>
        <div id="mineru-panel-storage" role="tabpanel" aria-labelledby="mineru-tab-storage" className={css.panel} hidden={tab !== 'storage'}>
          <StorageTab visible={tab === 'storage'} />
        </div>
        <ActionBar />
      </div>
    </SettingsContext.Provider>
  )
}