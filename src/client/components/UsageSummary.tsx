import type { ReactNode } from 'react'
import { Button, IconRefreshOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StorageAreaStatistics } from '../../contracts/maintenance.js'
import { formatBytes } from '../helpers.js'
import type { MineruKey } from '../locales.js'
import type { Maintenance } from '../maintenance-controller.js'
import { isPartialArea, isPartialStatistics } from '../maintenance.js'
import { useSettings } from '../settings-context.js'
import css from './Storage.module.css'

const AREAS = [
  { key: 'publishedResults', label: 'usage.results' },
  { key: 'staging', label: 'usage.staging' },
  { key: 'quarantine', label: 'usage.quarantine' },
] as const satisfies readonly { readonly key: string; readonly label: MineruKey }[]

function Tile({ label, area }: { readonly label: string; readonly area: StorageAreaStatistics | undefined }): ReactNode {
  const { t } = useSettings()
  return (
    <div className={css.tile}>
      <span className={css.tileLabel}>{label}</span>
      <span className={css.tileValue}>{area === undefined ? '—' : formatBytes(area.byteUsage, isPartialArea(area))}</span>
      <span className={css.tileMeta}>{area === undefined ? ' ' : t('usage.items', { count: area.logicalEntryCount })}</span>
    </div>
  )
}

export function UsageSummary({ maintenance }: { readonly maintenance: Maintenance }): ReactNode {
  const { t } = useSettings()
  const { stats, busy } = maintenance
  return (
    <div className={css.usage}>
      <div className={css.tiles}>
        {AREAS.map(area => <Tile key={area.key} label={t(area.label)} area={stats?.[area.key]} />)}
      </div>
      <div className={css.usageFoot}>
        <p className={css.foot} role="status">{stats !== undefined && isPartialStatistics(stats) ? t('usage.incomplete') : null}</p>
        <Button
          variant="ghost"
          size="sm"
          icon={<IconRefreshOutlineRegular />}
          disabled={busy !== undefined}
          onClick={() => { void maintenance.refresh() }}
        >
          {busy === 'stats' ? t('action.working') : t('action.refresh')}
        </Button>
      </div>
    </div>
  )
}
