import type { ReactNode } from 'react'
import { ChevronIcon } from './icons.js'
import css from './SettingsPage.module.css'

export interface DisclosureCardProps {
  readonly id: string
  readonly title: string
  readonly subtitle?: string
  readonly icon?: ReactNode
  readonly badge?: ReactNode
  readonly open: boolean
  readonly onToggle: () => void
  readonly action?: ReactNode
  readonly toggleTitle?: string
  readonly children: ReactNode
  readonly className?: string
}

export function DisclosureCard({
  id,
  title,
  subtitle,
  icon,
  badge,
  open,
  onToggle,
  action,
  toggleTitle,
  children,
  className,
}: DisclosureCardProps) {
  return (
    <div
      className={`${css.card} ${open ? css.cardOpen : ''} ${className ?? ''}`}
      data-card-id={id}
      data-card-open={open}
    >
      <div className={css.cardHeader}>
        <button
          type="button"
          className={css.cardHeadButton}
          aria-expanded={open}
          aria-controls={`card-body-${id}`}
          data-card-toggle={id}
          data-testid={`card-toggle-${id}`}
          title={toggleTitle}
          onClick={onToggle}
        >
          <div className={css.cardHeadLeft}>
            {icon && <span className={css.cardIcon}>{icon}</span>}
            <div className={css.cardHeadTitles}>
              <h3 className={css.cardTitle}>{title}</h3>
              {subtitle && <span className={css.cardSubtitle}>{subtitle}</span>}
            </div>
          </div>
          <div className={css.cardHeadRight}>
            {badge}
            <span
              className={`${css.chevron} ${open ? css.chevronOpen : ''}`}
              aria-hidden="true"
            >
              <ChevronIcon />
            </span>
          </div>
        </button>
        {action && (
          <div className={css.cardHeaderAction} onClick={e => e.stopPropagation()}>
            {action}
          </div>
        )}
      </div>
      <div
        id={`card-body-${id}`}
        className={css.cardBody}
        style={{ display: open ? undefined : 'none' }}
      >
        {children}
      </div>
    </div>
  )
}
