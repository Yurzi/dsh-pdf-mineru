import { describe, expect, it } from 'vitest'
import { MAX_CURSOR_LENGTH, cursorForRemainder, decodeReadCursor } from '../src/reader/read-cursor.js'

const token = (payload: Record<string, unknown>): string => Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
const v3 = { v: 3, rid: 'mr_sample', pages: '', focus: ['all'], off: 0, inline_images: true }

describe('cursor-v3 decoder', () => {
  it('round-trips a canonical selection and its inline-image intent', () => {
    const encoded = cursorForRemainder('mr_result', '1-3', new Set(['text', 'table']), 7)
    expect(decodeReadCursor(encoded)).toMatchObject({ rid: 'mr_result', pages: '1-3', focus: ['table', 'text'], off: 7, inline_images: true })
    expect(decodeReadCursor(cursorForRemainder('mr_result', undefined, new Set(['text']), 9)).pages).toBe('')
    expect(decodeReadCursor(token({ ...v3, inline_images: false })).inline_images).toBe(false)
  })

  it.each([1, 2])('expires legacy version %i tokens', version => {
    expect(() => decodeReadCursor(token({ ...v3, v: version }))).toThrow(/cursor is expired; re-read without a cursor/)
  })

  it.each([undefined, 'true', 0, null])('rejects a missing or non-boolean inline_images intent (%j)', inline_images => {
    expect(() => decodeReadCursor(token({ ...v3, inline_images }))).toThrow(/inline_images must be a boolean/)
  })

  it.each([
    { name: 'empty focus', patch: { focus: [] }, error: /cursor focus is not canonical/ },
    { name: 'duplicate focus', patch: { focus: ['text', 'text'] }, error: /cursor focus is not canonical/ },
    { name: 'unsorted focus', patch: { focus: ['text', 'all'] }, error: /cursor focus is not canonical/ },
    { name: 'query with toc', patch: { focus: ['all', 'toc'], query: 'test' }, error: /cursor selection cannot use toc or artifacts/ },
    { name: 'query with artifacts', patch: { focus: ['all', 'artifacts'], query: 'test' }, error: /cursor selection cannot use toc or artifacts/ },
    { name: 'a block of another result', patch: { rid: 'mr_alpha', block: 'mr_beta:b1' }, error: /cursor block belongs to another result/ },
    { name: 'non-canonical pages', patch: { pages: '3,1' }, error: /canonical/ },
  ])('rejects $name', ({ patch, error }) => {
    expect(() => decodeReadCursor(token({ ...v3, ...patch }))).toThrow(error)
  })

  it.each([
    { name: 'a tampered token', value: () => { const valid = cursorForRemainder('mr_result', '1-3', new Set(['text']), 7); return valid.slice(0, -1) + (valid.endsWith('A') ? 'B' : 'A') } },
    { name: 'an oversized token', value: () => 'A'.repeat(MAX_CURSOR_LENGTH + 1) },
    { name: 'non-JSON text', value: () => Buffer.from('not json').toString('base64url') },
  ])('rejects $name', ({ value }) => {
    expect(() => decodeReadCursor(value())).toThrow()
  })
})
