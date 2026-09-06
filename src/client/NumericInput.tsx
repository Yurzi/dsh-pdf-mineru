import { useEffect, useState, type ChangeEvent, type FocusEvent } from 'react'

export interface NumericInputProps {
  readonly className?: string
  readonly value: number
  readonly min?: number
  readonly max?: number
  readonly step?: number
  readonly disabled?: boolean
  readonly placeholder?: string
  readonly title?: string
  readonly onChange: (value: number) => void
}

export function parseNumericDraft(
  draft: string,
  min?: number,
  max?: number,
): { valid: boolean; value?: number } {
  const trimmed = draft.trim()
  if (trimmed === '') return { valid: false }
  const parsed = Number(trimmed)
  if (!Number.isSafeInteger(parsed)) return { valid: false }
  if (min !== undefined && parsed < min) return { valid: false }
  if (max !== undefined && parsed > max) return { valid: false }
  return { valid: true, value: parsed }
}

export function clampNumericDraft(
  draft: string,
  fallback: number,
  min?: number,
  max?: number,
): { nextDraft: string; value: number; changed: boolean } {
  const trimmed = draft.trim()
  if (trimmed === '') {
    return { nextDraft: String(fallback), value: fallback, changed: false }
  }
  const parsed = Number(trimmed)
  if (!Number.isSafeInteger(parsed)) {
    return { nextDraft: String(fallback), value: fallback, changed: false }
  }
  let clamped = parsed
  if (min !== undefined && clamped < min) clamped = min
  if (max !== undefined && clamped > max) clamped = max
  return {
    nextDraft: String(clamped),
    value: clamped,
    changed: clamped !== fallback,
  }
}

export function NumericInput({
  className,
  value,
  min,
  max,
  step,
  disabled,
  placeholder,
  title,
  onChange,
}: NumericInputProps) {
  const [draft, setDraft] = useState(() => (Number.isFinite(value) ? String(value) : ''))

  useEffect(() => {
    setDraft(Number.isFinite(value) ? String(value) : '')
  }, [value])

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const nextDraft = e.target.value
    setDraft(nextDraft)
    const result = parseNumericDraft(nextDraft, min, max)
    if (result.valid && result.value !== undefined) {
      onChange(result.value)
    }
  }

  const handleBlur = (_e: FocusEvent<HTMLInputElement>) => {
    const result = clampNumericDraft(draft, value, min, max)
    setDraft(result.nextDraft)
    if (result.changed) {
      onChange(result.value)
    }
  }

  return (
    <input
      type="number"
      className={className}
      value={draft}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      placeholder={placeholder}
      title={title}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  )
}
