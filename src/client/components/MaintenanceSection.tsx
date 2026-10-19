import { useEffect, type ReactNode } from 'react'
import { Button, IconCheckCircleOutlineRegular, IconTrashOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { formatBytes } from '../helpers.js'
import { useMaintenance } from '../maintenance-controller.js'
import { useSettings } from '../settings-context.js'
import { Row, Section } from './Field.js'
import { MaintenanceDialogs } from './MaintenanceDialogs.js'
import { QuarantineList } from './QuarantineList.js'
import { UsageSummary } from './UsageSummary.js'
import css from './Storage.module.css'

/** Usage, integrity check, cache clear and quarantine; loads usage the first time the tab is shown. */
export function MaintenanceSection({ visible }: { readonly visible: boolean }): ReactNode {
  const { rpc, t } = useSettings()
  const maintenance = useMaintenance(rpc)
  const { busy, scan, cleared, stats } = maintenance
  const idle = busy === undefined

  const firstLoad = visible && stats === undefined && busy === undefined && maintenance.error === undefined
  useEffect(() => {
    if (firstLoad) void maintenance.refresh()
  }, [firstLoad, maintenance])

  return (
    <Section name="maintenance" title={t('section.maintenance')}>
      <UsageSummary maintenance={maintenance} />
      {maintenance.error === undefined ? null : <p className={css.error} role="alert">{maintenance.error}</p>}
      <Row
        id="mineru-verify"
        label={t('maint.verify')}
        hint={scan === undefined ? t('maint.verify.hint') : t('verify.result', {
          valid: scan.validCount, corrupt: scan.corruptCount, missing: scan.missingCount, unreadable: scan.unreadableCount,
        })}
        compact
        labelsControl={false}
      >
        <Button variant="outline" size="sm" icon={<IconCheckCircleOutlineRegular />} disabled={!idle} onClick={() => { void maintenance.verify() }}>
          {busy === 'verify' ? t('action.working') : t('action.verify')}
        </Button>
      </Row>
      <Row
        id="mineru-clear"
        label={t('maint.clear')}
        hint={cleared === undefined ? t('maint.clear.hint') : t('clear.done', { count: cleared.deletedCount, size: formatBytes(cleared.deletedBytes) })}
        compact
        labelsControl={false}
      >
        <Button variant="outline" size="sm" icon={<IconTrashOutlineRegular />} disabled={!idle} onClick={() => { void maintenance.previewClear() }}>
          {busy === 'clearPreview' ? t('action.working') : t('action.clear')}
        </Button>
      </Row>
      <Row id="mineru-quarantine" label={t('maint.quarantine')} hint={t('maint.quarantine.hint')} compact labelsControl={false}>
        <Button variant="outline" size="sm" disabled={!idle} onClick={() => { void maintenance.listQuarantine() }}>
          {busy === 'list' ? t('action.working') : t('action.review')}
        </Button>
      </Row>
      <QuarantineList maintenance={maintenance} />
      <MaintenanceDialogs maintenance={maintenance} />
    </Section>
  )
}