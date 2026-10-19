export const FOCUS_KINDS = ['all', 'text', 'table', 'image', 'toc', 'artifacts'] as const
export type FocusKind = typeof FOCUS_KINDS[number]

const MAX_PAGE = 99999
const BLOCK_ID = /^mr_[a-zA-Z0-9_-]+:b[1-9][0-9]*$/
const MAX_BLOCK_ID_CHARS = 160
const MAX_QUERY_CHARS = 256

/** Continuation token payload, decoded and structurally validated by read-cursor. */
export interface ReadCursorPayload {
  readonly v: 3
  /** Immutable result identity the offset belongs to. */
  readonly rid: string
  /** Canonical pages label ('' means the full selection). */
  readonly pages: string
  /** Canonical sorted focus list. */
  readonly focus: readonly FocusKind[]
  /** UTF-16 offset into the exact projected selection text. */
  readonly off: number
  /** Caller presentation intent, independent of runtime attachment capability and budgets. */
  readonly inline_images: boolean
  readonly block?: string
  readonly query?: string
  readonly projection?: string
}

/** One exact block or one literal search; never both. */
export type SelectionTarget =
  | { readonly kind: 'block'; readonly blockId: string }
  | { readonly kind: 'query'; readonly text: string }

export interface ContentSelection {
  readonly pages?: ReadonlySet<number>
  readonly focus: ReadonlySet<FocusKind>
  readonly target?: SelectionTarget
}

interface ContentDelivery {
  /** Caller image intent: explicit flag, else the cursor's intent, else true. */
  readonly inlineImages: boolean
  /** Synchronous wait bound; omitted uses polling.pollTimeoutMs. */
  readonly pollTimeoutMs?: number
}

/** One validated read request. Exclusive selectors cannot be combined by construction. */
export type ReadQuery =
  | ({ readonly kind: 'select'; readonly selection: ContentSelection } & ContentDelivery)
  | ({ readonly kind: 'continue'; readonly cursor: ReadCursorPayload } & ContentDelivery)
  | { readonly kind: 'page'; readonly page: number; readonly expectedSha256?: string }

export type ContentQuery = Exclude<ReadQuery, { readonly kind: 'page' }>

export function isBlockId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_BLOCK_ID_CHARS && BLOCK_ID.test(value)
}

export function isQueryText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= MAX_QUERY_CHARS
}

export function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

/** Cursor selection fields restored as a selection; the cursor text offset stays with the payload. */
export function cursorSelection(cursor: ReadCursorPayload): ContentSelection {
  const target: SelectionTarget | undefined = cursor.block !== undefined ? { kind: 'block', blockId: cursor.block }
    : cursor.query !== undefined ? { kind: 'query', text: cursor.query } : undefined
  return {
    ...(cursor.pages === '' ? {} : { pages: normalizePageSelection(cursor.pages) }),
    focus: normalizeFocusSelection(cursor.focus),
    ...(target === undefined ? {} : { target }),
  }
}

interface PageInterval { start: number; end: number }

function parsePageRangeTokens(input: string): PageInterval[] {
  const intervals: PageInterval[] = []
  for (const token of input.split(',')) {
    const trimmed = token.trim()
    if (trimmed === '') continue
    const match = /^(\d+)(?:-(\d+))?$/.exec(trimmed)
    if (match === null) throw new TypeError(`Invalid page range token: ${trimmed}`)
    const start = Number(match[1])
    const end = match[2] === undefined ? start : Number(match[2])
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end > MAX_PAGE) {
      throw new TypeError(`Invalid page range token: ${trimmed}`)
    }
    intervals.push({ start, end })
  }
  if (intervals.length === 0) throw new TypeError('Page range cannot be empty')
  return intervals
}

export function normalizePageRanges(input: string): string {
  const intervals = parsePageRangeTokens(input)
  intervals.sort((left, right) => left.start - right.start || left.end - right.end)
  const merged: PageInterval[] = []
  for (const current of intervals) {
    const previous = merged.at(-1)
    if (previous !== undefined && current.start <= previous.end + 1) previous.end = Math.max(previous.end, current.end)
    else merged.push({ ...current })
  }
  return merged.map(({ start, end }) => start === end ? String(start) : `${String(start)}-${String(end)}`).join(',')
}

export interface PageNarrowing {
  readonly pagesSet: Set<number> | undefined
  readonly pagesLabel: string
  /** Pages requested but outside 1..totalPages; reported, never silently replaced. */
  readonly outOfRange: readonly number[]
  /** True when the request asked for pages but none overlap the document. */
  readonly fullyOutOfRange: boolean
}

export function narrowPageSelection(
  requested: ReadonlySet<number> | undefined,
  totalPages: number | undefined,
): PageNarrowing {
  if (requested === undefined) {
    if (totalPages === undefined) {
      return { pagesSet: undefined, pagesLabel: "", outOfRange: [], fullyOutOfRange: false }
    }
    const maxBound = Math.max(1, totalPages)
    const pagesLabel = maxBound > 1 ? "1-" + String(maxBound) : "1"
    return { pagesSet: undefined, pagesLabel, outOfRange: [], fullyOutOfRange: false }
  }
  if (totalPages === undefined) {
    return {
      pagesSet: new Set(requested),
      pagesLabel: normalizePageRanges([...requested].join(',')),
      outOfRange: [],
      fullyOutOfRange: false,
    }
  }
  const maxBound = Math.max(1, totalPages)
  const valid = new Set<number>()
  const outOfRange: number[] = []
  for (const p of requested) {
    if (p >= 1 && p <= maxBound) valid.add(p)
    else outOfRange.push(p)
  }
  outOfRange.sort((a, b) => a - b)
  if (valid.size === 0) {
    return { pagesSet: new Set<number>(), pagesLabel: "", outOfRange, fullyOutOfRange: true }
  }
  return { pagesSet: valid, pagesLabel: normalizePageRanges([...valid].join(',')), outOfRange, fullyOutOfRange: false }
}

export function normalizePageSelection(input: unknown): Set<number> | undefined {
  if (input === undefined || input === null) return undefined
  if (typeof input === 'number') {
    if (!Number.isSafeInteger(input) || input < 1 || input > MAX_PAGE) {
      throw new TypeError(`Invalid page number: ${String(input)}`)
    }
    return new Set([input])
  }
  if (Array.isArray(input)) {
    if (input.length === 0) throw new TypeError('Page selection cannot be empty')
    const set = new Set<number>()
    for (const item of input) {
      if (typeof item === 'number') {
        if (!Number.isSafeInteger(item) || item < 1 || item > MAX_PAGE) {
          throw new TypeError(`Invalid page number: ${String(item)}`)
        }
        set.add(item)
      } else {
        throw new TypeError(`Invalid page selection item: ${String(item)}`)
      }
    }
    return set
  }
  if (typeof input === 'string') {
    if (input.trim() === '') throw new TypeError('Page range cannot be empty')
    const intervals = parsePageRangeTokens(input)
    const set = new Set<number>()
    for (const { start, end } of intervals) {
      for (let p = start; p <= end; p++) set.add(p)
    }
    return set
  }
  throw new TypeError(`Invalid page selection: ${String(input)}`)
}

function parseFocusToken(item: unknown): FocusKind {
  if (typeof item !== 'string') throw new TypeError(`Invalid focus option: ${String(item)}`)
  const trimmed = item.trim().toLowerCase()
  if (!FOCUS_KINDS.includes(trimmed as FocusKind)) {
    throw new TypeError(`Invalid focus option: ${String(item)}`)
  }
  return trimmed as FocusKind
}

export function normalizeFocusSelection(input: unknown): Set<FocusKind> {
  if (input === undefined || input === null) return new Set(['all'])
  if (typeof input === 'string') {
    return new Set([parseFocusToken(input)])
  }
  if (Array.isArray(input)) {
    if (input.length === 0) return new Set(['all'])
    const set = new Set<FocusKind>()
    for (const item of input) {
      set.add(parseFocusToken(item))
    }
    return set
  }
  throw new TypeError(`Invalid focus option: ${String(input)}`)
}
