import type { ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { formatBytes } from '../helpers.js'
import type { Maintenance } from '../maintenance-controller.js'
import { cacheClearConfirmRequest } from '../maintenance.js'
import { useSettings } from '../settings-context.js'
import css from './Storage.module.css'

function ConfirmDialog({ title, body, canConfirm, busy, onCancel, onConfirm }: {
  readonly title: string
  readonly body: string
  readonly canConfirm: boolean
  readonly busy: boolean
  readonly onCancel: () => void
  readonly onConfirm: () => void
}): ReactNode {
  const { t } = useSettings()
  return (
    <Modal
      open
      title={title}
      closeLabel={t('action.close')}
      onClose={onCancel}
      footer={(
        <div className={css.dialogFooter}>
          {/* Cancel takes initial focus so Enter never deletes by accident. */}
          <Button variant="ghost" size="md" data-modal-autofocus onClick={onCancel}>{t('action.cancel')}</Button>
          {canConfirm
            ? <Button variant="primary" size="md" disabled={busy} onClick={onConfirm}>{busy ? t('action.working') : t('action.delete')}</Button>
            : null}
        </div>
      )}
    >
      <p className={css.dialogBody}>{body}</p>
      {canConfirm ? <p className={css.dialogNote}>{t('dialog.irreversible')}</p> : null}
    </Modal>
  )
}

export function MaintenanceDialogs({ maintenance }: { readonly maintenance: Maintenance }): ReactNode {
  const { t } = useSettings()
  const { clearPreview, cleanupPreview, busy } = maintenance
  if (clearPreview !== undefined) {
    const allowed = cacheClearConfirmRequest(clearPreview) !== undefined
    return (
      <ConfirmDialog
        title={t('dialog.clear.title')}
        body={allowed
          ? t('dialog.clear.ready', { count: clearPreview.plannedCount, size: formatBytes(clearPreview.plannedBytes) })
          : t('dialog.clear.blocked')}
        canConfirm={allowed}
        busy={busy === 'clear'}
        onCancel={maintenance.cancelClear}
        onConfirm={() => { void maintenance.confirmClear() }}
      />
    )
  }
  if (cleanupPreview !== undefined) {
    return (
      <ConfirmDialog
        title={t('dialog.quarantine.title')}
        body={t('dialog.quarantine.body', { count: cleanupPreview.plannedCount, size: formatBytes(cleanupPreview.plannedBytes) })}
        canConfirm={cleanupPreview.entries.length > 0}
        busy={busy === 'cleanup'}
        onCancel={maintenance.cancelCleanup}
        onConfirm={() => { void maintenance.confirmCleanup() }}
      />
    )
  }
  return null
}