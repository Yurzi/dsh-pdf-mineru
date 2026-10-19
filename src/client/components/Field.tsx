import { useId, useState, type ReactNode } from 'react'
import { IconChevronDownOutlineRegular, Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { useSettings } from '../settings-context.js'
import { formatNumber, parseNumber, readNumber, writeNumber, type NumberFieldSpec } from '../units.js'
import css from './Field.module.css'

export function cx(...names: readonly (string | false | undefined)[]): string {
  return names.filter(Boolean).join(' ')
}

/** aria-describedby for a control whose hint and error use the `<id>-hint` / `<id>-error` convention. */
export function describedBy(id: string, hint: unknown, error: unknown): string | undefined {
  return [hint ? id + '-hint' : '', error ? id + '-error' : ''].filter(Boolean).join(' ') || undefined
}

export interface Collapsible {
  readonly open: boolean
  readonly onToggle: () => void
}

/**
 * A titled settings card. With `collapsible`, the title is the disclosure toggle and the
 * card renders only while open; drafts live in the controller, so collapsing loses nothing.
 */
export function Section({ name, title, hint, collapsible, children }: {
  /** Stable hook for tests and verification (`data-section`). */
  readonly name: string
  readonly title: string
  readonly hint?: string | undefined
  readonly collapsible?: Collapsible | undefined
  readonly children: ReactNode
}): ReactNode {
  const id = useId()
  const cardId = id + '-card'
  const open = collapsible?.open ?? true
  return (
    <section className={css.section} aria-labelledby={id} data-section={name}>
      <div className={css.sectionHead}>
        {collapsible === undefined
          ? <h4 id={id} className={css.sectionTitle}>{title}</h4>
          : (
            <h4 className={css.sectionTitle}>
              <button
                id={id}
                type="button"
                className={css.sectionToggle}
                aria-expanded={open}
                aria-controls={cardId}
                onClick={collapsible.onToggle}
              >
                <IconChevronDownOutlineRegular className={css.chevron} />
                {title}
              </button>
            </h4>
          )}
        {hint === undefined ? null : <p className={css.sectionHint}>{hint}</p>}
      </div>
      {open ? <div id={cardId} className={css.card}>{children}</div> : null}
    </section>
  )
}

/** Trailing card action with its explanation, e.g. restoring a section's defaults. */
export function CardFooter({ id, hint, children }: { readonly id: string; readonly hint: string; readonly children: ReactNode }): ReactNode {
  return (
    <div className={css.footer}>
      <p className={css.hint} id={id}>{hint}</p>
      {children}
    </div>
  )
}

/** Rows nested inside a card child keep the card's hairline rhythm. */
export function RowGroup({ id, children }: { readonly id?: string; readonly children: ReactNode }): ReactNode {
  return <div id={id} className={css.group}>{children}</div>
}

export interface RowProps {
  readonly id: string
  readonly label: ReactNode
  readonly hint?: ReactNode
  readonly error?: ReactNode
  /** Label above a full-width control instead of beside it. */
  readonly stacked?: boolean
  /** Keep label and control on one line even in narrow cards (switches, short actions). */
  readonly compact?: boolean
  /** The label names a native control with this id; otherwise the control carries its own name. */
  readonly labelsControl?: boolean
  readonly children?: ReactNode
}

/** One hairline-separated settings row: label and hint, then the control. */
export function Row({ id, label, hint, error, stacked, compact, labelsControl = true, children }: RowProps): ReactNode {
  return (
    <div className={cx(css.row, stacked && css.stacked, compact && css.compact)}>
      <div className={css.text}>
        {labelsControl
          ? <label className={css.label} htmlFor={id}>{label}</label>
          : <span className={css.label} id={id + '-label'}>{label}</span>}
        {hint ? <p className={css.hint} id={id + '-hint'}>{hint}</p> : null}
      </div>
      {children === undefined ? null : <div className={css.control}>{children}</div>}
      {error ? <p className={css.error} id={id + '-error'} role="alert">{error}</p> : null}
    </div>
  )
}

export function TextField({ id, label, hint, value, onChange, placeholder, type = 'text', disabled, children }: {
  readonly id: string
  readonly label: string
  readonly hint?: ReactNode
  readonly value: string
  readonly onChange: (value: string) => void
  readonly placeholder?: string | undefined
  readonly type?: 'text' | 'password' | 'url'
  readonly disabled?: boolean | undefined
  /** Extra controls after the input, such as a status tag. */
  readonly children?: ReactNode
}): ReactNode {
  return (
    <Row id={id} label={label} hint={hint} stacked>
      <Input
        id={id}
        className={css.input}
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        autoComplete={type === 'password' ? 'off' : undefined}
        aria-describedby={describedBy(id, hint, false)}
        onChange={event => { onChange(event.target.value) }}
      />
      {children}
    </Row>
  )
}

export interface SelectOption<V extends string> {
  readonly value: V
  readonly label: string
}

export function SelectField<V extends string>({ id, label, hint, note, value, options, onChange }: {
  readonly id: string
  readonly label: string
  readonly hint?: string | undefined
  /** Contextual message shown under the row, e.g. why the value changed. */
  readonly note?: string | undefined
  readonly value: V
  readonly options: readonly SelectOption<V>[]
  readonly onChange: (value: V) => void
}): ReactNode {
  const noteId = id + '-note'
  const describe = [describedBy(id, hint, false), note ? noteId : undefined].filter(Boolean).join(' ') || undefined
  return (
    <Row id={id} label={label} hint={hint}>
      <span className={css.selectWrap}>
        <select
          id={id}
          className={css.select}
          value={value}
          aria-describedby={describe}
          onChange={event => { onChange(event.target.value as V) }}
        >
          {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <IconChevronDownOutlineRegular className={css.selectIcon} />
      </span>
      {note ? <p className={css.note} id={noteId} role="status">{note}</p> : null}
    </Row>
  )
}

export function SwitchRow({ id, label, hint, checked, onChange, disabled }: {
  readonly id: string
  readonly label: string
  readonly hint?: string | undefined
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
  readonly disabled?: boolean
}): ReactNode {
  return (
    <Row id={id} label={label} hint={hint} compact labelsControl={false}>
      <Switch checked={checked} onChange={onChange} label={label} disabled={disabled} />
    </Row>
  )
}

/**
 * A base-unit integer edited in display units. While focused the typed text is kept as-is;
 * every valid value commits to the draft immediately, and blur restores the committed value.
 */
export function NumberField({ spec }: { readonly spec: NumberFieldSpec }): ReactNode {
  const { settings, t } = useSettings()
  const [editing, setEditing] = useState<string>()
  const config = settings.state.draft
  const bounds = spec.bounds(config)
  const value = readNumber(config, spec)
  const text = editing ?? formatNumber(value, spec.scale)
  const invalid = editing !== undefined && parseNumber(editing, spec.scale, bounds) === undefined
  const error = invalid
    ? t('field.range', { min: formatNumber(bounds[0], spec.scale), max: formatNumber(bounds[1], spec.scale) })
    : undefined
  return (
    <Row id={spec.id} label={t(spec.label)} hint={spec.hint === undefined ? undefined : t(spec.hint)} error={error}>
      <span className={css.number}>
        <Input
          id={spec.id}
          className={css.numberInput}
          inputMode="decimal"
          value={text}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy(spec.id, spec.hint, error)}
          onChange={event => {
            const next = event.target.value
            setEditing(next)
            const base = parseNumber(next, spec.scale, bounds)
            if (base !== undefined && base !== value) settings.edit(current => writeNumber(current, spec, base))
          }}
          onBlur={() => { setEditing(undefined) }}
        />
        <span className={css.unit}>{t(spec.unit)}</span>
      </span>
    </Row>
  )
}

/** Inline disclosure toggle in the host's details style; content stays caller-owned. */
export function DisclosureButton({ id, open, onToggle, children }: {
  readonly id: string
  readonly open: boolean
  readonly onToggle: () => void
  readonly children: ReactNode
}): ReactNode {
  return (
    <button type="button" className={css.disclosure} aria-expanded={open} aria-controls={id} onClick={onToggle}>
      <IconChevronDownOutlineRegular className={css.chevron} />
      {children}
    </button>
  )
}