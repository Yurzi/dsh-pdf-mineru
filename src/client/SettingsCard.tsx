import { SettingsPage, type SettingsPageProps } from './SettingsPage.js'
import css from './SettingsCard.module.css'

/** Native disclosure keeps the form mounted, including unsaved edits, when closed. */
export function SettingsCard(props: SettingsPageProps): JSX.Element {
  return (
    <details className={css.card}>
      <summary className={css.header}>
        <span className={css.heading}>
          <span className={css.title}>{props.t('page.title')}</span>
          <span className={css.description}>{props.t('card.description')}</span>
        </span>
        <svg className={css.chevron} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div className={css.body}>
        <SettingsPage {...props} embedded />
      </div>
    </details>
  )
}
