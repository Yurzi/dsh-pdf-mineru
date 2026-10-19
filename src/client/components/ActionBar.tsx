import type { ReactNode } from 'react'
import { Button, IconCheckOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { useSettings } from '../settings-context.js'
import { actionBarMode } from '../settings-state.js'
import { cx } from './Field.js'
import css from './ActionBar.module.css'

/**
 * Floating save bar, present only when there is something to act on: a dirty draft,
 * a save in flight, a failure, a revision conflict, or a brief "Saved" confirmation.
 */
export function ActionBar(): ReactNode {
  const { settings, t } = useSettings()
  const { state } = settings
  const mode = actionBarMode(state)
  if (mode === 'hidden') return null

  if (mode === 'saved') {
    return (
      <div className={css.dock}>
        <p className={cx(css.bar, css.saved)} role="status" data-action-bar="saved">
          <IconCheckOutlineRegular size={14} />
          {t('bar.saved')}
        </p>
      </div>
    )
  }

  const message = state.status.kind === 'error' ? t('bar.failed', { message: state.status.message })
    : mode === 'conflict' ? t('bar.conflict')
    : mode === 'saving' ? t('bar.saving')
    : t('bar.unsaved')
  const tone = mode === 'error' || mode === 'conflict' ? css.problem : undefined
  return (
    <div className={css.dock}>
      <div className={css.bar} data-action-bar={mode}>
        <p className={cx(css.status, tone)} role={tone === undefined ? 'status' : 'alert'} title={message}>{message}</p>
        {mode === 'conflict'
          ? <Button variant="primary" size="sm" onClick={() => { void settings.reload() }}>{t('action.reload')}</Button>
          : (
            <>
              <Button variant="ghost" size="sm" disabled={mode === 'saving'} onClick={settings.discard}>{t('action.discard')}</Button>
              <Button variant="primary" size="sm" disabled={settings.mutation !== undefined} onClick={() => { void settings.save() }}>{t('action.save')}</Button>
            </>
          )}
      </div>
    </div>
  )
}