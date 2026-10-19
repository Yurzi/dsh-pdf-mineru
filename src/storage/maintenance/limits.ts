/** Bounded maintenance work; truncation never grants destructive eligibility. */
export const DEFAULT_RESULT_SCAN_LIMIT = 10_000
export const DEFAULT_DIAGNOSTIC_LIMIT = 100
export const DEFAULT_QUARANTINE_LIST_LIMIT = 100
export const MAX_RESULT_SCAN_LIMIT = 50_000
export const MAX_DIAGNOSTIC_LIMIT = 1_000
export const MAX_QUARANTINE_LIST_LIMIT = 1_000

export function boundedLimit(value: number | undefined, fallback: number, maximum: number, label: string): number {
  const resolved = value === undefined ? fallback : value
  if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > maximum) {
    throw new TypeError(`${label} must be a positive safe integer no greater than ${maximum}`)
  }
  return resolved
}
