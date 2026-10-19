import type { ReactNode } from 'react'
import { Button, Checkbox } from '@deepseek-ai/dsh-client-ui-primitives'
import { formatBytes } from '../helpers.js'
import type { Maintenance } from '../maintenance-controller.js'
import { useSettings } from '../settings-context.js'
import css from './Storage.module.css'

export function QuarantineList({ maintenance }: { readonly maintenance: Maintenance }): ReactNode {
  const { t } = useSettings()
  const { quarantine, selected, busy, cleaned } = maintenance
  if (quarantine === undefined) return null
  const entries = quarantine.entries
  return (
    <div className={css.quarantine} data-quarantine>
      {cleaned === undefined ? null : <p className={css.foot} role="status">{t('quarantine.done', { count: cleaned.deletedCount })}</p>}
      {entries.length === 0 ? <p className={css.foot}>{t('quarantine.empty')}</p> : (
        <>
          <Checkbox
            label={t('quarantine.selectAll')}
            checked={selected.length === entries.length}
            onChange={maintenance.selectAll}
          />
          <ul className={css.entries}>
            {entries.map(entry => (
              <li key={entry.id} className={css.entry}>
                <Checkbox label={entry.id} checked={selected.includes(entry.id)} onChange={() => { maintenance.toggle(entry.id) }} />
                <span className={css.entryMeta}>{formatBytes(entry.byteUsage)}</span>
              </li>
            ))}
          </ul>
          <div>
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== undefined || selected.length === 0}
              onClick={() => { void maintenance.previewCleanup() }}
            >
              {busy === 'cleanupPreview' ? t('action.working') : t('action.deleteSelected')}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}