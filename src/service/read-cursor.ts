/**
 * read-cursor.ts — bounded, stateless continuation tokens for read_pdf partial output.
 *
 * A cursor binds one immutable result identity to the canonical selection that
 * produced the text plus a UTF-16 offset into that exact projected text. The
 * token is self-contained: the service can re-derive the selection without
 * requiring the caller to repeat pages/focus (which are rejected when a cursor
 * is present). No server state, no sidecar files, no signatures.
 */
import { MinerUError, failure } from '../domain/errors.js';
import { FOCUS_KINDS, normalizePageRanges, type FocusKind } from '../domain/request.js';

/** Cursor payload version. Bump only with an explicit compatibility rule. */
export const READ_CURSOR_VERSION = 1 as const;
/** Hard cap on the encoded cursor length (base64url JSON). */
export const MAX_CURSOR_LENGTH = 2048 as const;
/** Hard cap on encoded canonical selection complexity (pages + focus tokens). */
export const MAX_CURSOR_SELECTION_CHARS = 1024 as const;

export interface ReadCursorPayload {
  readonly v: typeof READ_CURSOR_VERSION;
  /** Immutable result identity the offset belongs to. */
  readonly rid: string;
  /** Canonical pages label ('' means the full selection). */
  readonly pages: string;
  /** Canonical sorted focus list. */
  readonly focus: readonly FocusKind[];
  /** UTF-16 offset into the exact projected selection text. */
  readonly off: number;
}

export interface ResolvedSelection {
  readonly pages: ReadonlySet<number> | undefined;
  readonly focus: ReadonlySet<FocusKind>;
}

function canonicalFocusList(focus: ReadonlySet<FocusKind>): FocusKind[] {
  return [...focus].sort();
}

function parseFocusList(input: unknown): FocusKind[] {
  if (!Array.isArray(input)) throw new TypeError('cursor focus must be an array');
  const out: FocusKind[] = [];
  for (const item of input) {
    if (typeof item !== 'string') throw new TypeError('cursor focus entries must be strings');
    const token = item.trim().toLowerCase();
    if (!(FOCUS_KINDS as readonly string[]).includes(token)) throw new TypeError('unknown cursor focus: ' + item);
    out.push(token as FocusKind);
  }
  return [...new Set(out)].sort();
}

function parsePagesLabel(input: unknown): string {
  if (typeof input !== 'string') throw new TypeError('cursor pages must be a string');
  if (input === '') return '';
  if (input.length > MAX_CURSOR_SELECTION_CHARS) throw new TypeError('cursor pages selection is too complex');
  const seen = new Set<number>();
  for (const token of input.split(',')) {
    const trimmed = token.trim();
    if (trimmed === '') throw new TypeError('cursor pages selection is malformed');
    const m = /^(\d+)(?:-(\d+))?$/.exec(trimmed);
    if (m === null) throw new TypeError('cursor pages selection is malformed');
    const start = Number(m[1]);
    const end = m[2] === undefined ? start : Number(m[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end > 99999) {
      throw new TypeError('cursor pages selection is out of range');
    }
    for (let p = start; p <= end; p++) {
      seen.add(p);
    }
  }
  if (seen.size === 0) throw new TypeError('cursor pages selection is malformed');
  return input;
}

function toBase64Url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function fromBase64Url(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

/** Encode a cursor bound to one result identity, selection, and text offset. */
export function encodeReadCursor(payload: ReadCursorPayload): string {
  if (!Number.isSafeInteger(payload.off) || payload.off < 0) {
    throw new TypeError('cursor offset must be a non-negative safe integer');
  }
  if (payload.rid.trim() === '') throw new TypeError('cursor result identity is required');
  const canonical = {
    v: READ_CURSOR_VERSION,
    rid: payload.rid,
    pages: payload.pages,
    focus: [...payload.focus].sort(),
    off: payload.off,
  };
  const json = JSON.stringify(canonical);
  if (json.length > MAX_CURSOR_SELECTION_CHARS + 256) {
    throw new MinerUError(failure('INVALID_REQUEST', 'Selection is too complex to continue with a cursor; narrow pages or focus'));
  }
  const token = toBase64Url(json);
  if (token.length > MAX_CURSOR_LENGTH) {
    throw new MinerUError(failure('INVALID_REQUEST', 'Selection is too complex to continue with a cursor; narrow pages or focus'));
  }
  return token;
}

/** Decode and structurally validate a cursor token. Never throws MinerUError. */
export function decodeReadCursor(token: string): ReadCursorPayload {
  if (typeof token !== 'string' || token.trim() === '' || token.length > MAX_CURSOR_LENGTH) {
    throw new TypeError('cursor is malformed or expired; re-read without a cursor');
  }
  let json: string;
  try {
    json = fromBase64Url(token.trim());
  } catch {
    throw new TypeError('cursor is malformed or expired; re-read without a cursor');
  }
  if (json.length > MAX_CURSOR_SELECTION_CHARS + 256) {
    throw new TypeError('cursor is malformed or expired; re-read without a cursor');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new TypeError('cursor is malformed or expired; re-read without a cursor');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new TypeError('cursor is malformed or expired; re-read without a cursor');
  }
  const obj = raw as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  if (keys.join(',') !== 'focus,off,pages,rid,v') throw new TypeError('cursor is malformed or expired; re-read without a cursor');
  if (obj.v !== READ_CURSOR_VERSION) throw new TypeError('cursor is expired; re-read without a cursor');
  if (typeof obj.rid !== 'string' || obj.rid.trim() === '') {
    throw new TypeError('cursor is malformed or expired; re-read without a cursor');
  }
  const pages = parsePagesLabel(obj.pages);
  if (pages !== '' && normalizePageRanges(pages) !== pages) throw new TypeError('cursor selection is not canonical; re-read without a cursor');
  const focus = parseFocusList(obj.focus);
  if (typeof obj.off !== 'number' || !Number.isSafeInteger(obj.off) || obj.off < 0) {
    throw new TypeError('cursor is malformed or expired; re-read without a cursor');
  }
  return { v: READ_CURSOR_VERSION, rid: obj.rid, pages, focus, off: obj.off };
}

/** Resolve the canonical selection stored in a decoded cursor. */
export function selectionFromCursor(payload: ReadCursorPayload): ResolvedSelection {
  let pages: ReadonlySet<number> | undefined;
  if (payload.pages !== '') {
    const set = new Set<number>();
    for (const token of payload.pages.split(',')) {
      const m = /^(\d+)(?:-(\d+))?$/.exec(token.trim());
      if (m === null) throw new TypeError('cursor pages selection is malformed');
      const start = Number(m[1]);
      const end = m[2] === undefined ? start : Number(m[2]);
      for (let p = start; p <= end; p++) set.add(p);
    }
    pages = set;
  }
  return { pages, focus: new Set<FocusKind>(payload.focus) };
}

/** Canonical pages label for cursor binding ('' means full selection). */
export function canonicalSelectionKey(pagesLabel: string | undefined, focus: ReadonlySet<FocusKind>): string {
  const pages = pagesLabel ?? '';
  return pages + '|' + canonicalFocusList(focus).join(',');
}

/** Create a cursor for the remainder of projected text starting at offset. */
export function cursorForRemainder(
  resultId: string,
  pagesLabel: string | undefined,
  focus: ReadonlySet<FocusKind>,
  offset: number,
): string {
  return encodeReadCursor({ v: READ_CURSOR_VERSION, rid: resultId, pages: pagesLabel ?? '', focus: canonicalFocusList(focus), off: offset });
}
