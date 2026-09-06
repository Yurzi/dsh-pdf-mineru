import { describe, expect, it } from 'vitest'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { parseReadInput, registerTools } from '../src/tools.js'
import { cursorForRemainder, decodeReadCursor } from '../src/service/read-cursor.js'
import { narrowPageSelection } from '../src/domain/request.js'
import { formatResultProse, formatSingleSummaryProse, type ResultView } from '../src/service/result-presenter.js'

describe('reader repairs', () => {
  it('round-trips a canonical cursor and preserves Unicode-safe offsets', () => {
    const token = cursorForRemainder('mr_result', '1-3', new Set(['text', 'table']), 7)
    const decoded = decodeReadCursor(token)
    expect(decoded).toMatchObject({ v: 1, rid: 'mr_result', pages: '1-3', focus: ['table', 'text'], off: 7 })
    expect(decodeReadCursor(cursorForRemainder('mr_result', undefined, new Set(['text']), 9)).pages).toBe('')
  })

  it('rejects altered or non-canonical cursor payloads', () => {
    const token = cursorForRemainder('mr_result', '1-3', new Set(['text']), 4)
    const altered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A')
    expect(() => decodeReadCursor(altered)).toThrow()
    const payload = Buffer.from(JSON.stringify({ v: 1, rid: 'mr_result', pages: '3,1', focus: ['text'], off: 4 })).toString('base64url')
    expect(() => decodeReadCursor(payload)).toThrow(/canonical/)
  })

  it('requires file_path, rejects unknown arguments, and accepts cursor-only continuation', () => {
    expect(() => parseReadInput({ pages: 1 })).toThrow(/file_path.*required/)
    expect(() => parseReadInput({ file_path: '/tmp/a.pdf', unexpected: true })).toThrow(/Unsupported parameter/)
    expect(parseReadInput({ file_path: '/tmp/a.pdf', cursor: 'opaque' }).input).toEqual({ file_path: '/tmp/a.pdf', cursor: 'opaque' })
    expect(() => parseReadInput({ file_path: '/tmp/a.pdf', cursor: 'opaque', pages: 1 })).toThrow(/must be omitted/)
  })

  it('real compiled output schema rejects an empty nested result file', () => {
    let definition: any
    const ctx = { tools: { register: (value: any) => { definition = value; return () => undefined }, schemas: () => [] }, get: () => undefined } as any
    registerTools(ctx, () => { throw new Error('not executed') })
    const invalid = { state: 'completed', source: 'provider', cache_hit: false, result_id: 'mr_empty', files: [{}], content_status: 'complete', manifest_path: '/cache/m.json', output_limit_chars: 1000 }
    const violations = validateJsonSchemaValue(definition.output.schema, invalid, 'value')
    expect(violations.some((value: string) => value.includes('value.files[0].file_id'))).toBe(true)
    expect(violations.some((value: string) => value.includes('value.files[0].name'))).toBe(true)
    expect(violations.some((value: string) => value.includes('value.files[0].artifacts'))).toBe(true)
  })

  it('omits unknown heading coordinates from both Native presenters', () => {
    const toc = [{ level: 1, title: 'Title without a location' }]
    const view: ResultView = {
      state: 'completed', source: 'cache', cache_hit: true, result_id: 'mr_test',
      files: [{ file_id: 'mf_test', name: 'document.pdf', artifacts: [] }],
      content_status: 'partial', markdown_content: 'First chunk',
      cursor: cursorForRemainder('mr_test', undefined, new Set(['all']), 11),
      summary: { toc }, toc,
    }
    for (const render of [formatResultProse, formatSingleSummaryProse]) {
      expect(render(view)).toContain('Title without a location')
      expect(render(view)).not.toMatch(/line undefined|line 0/)
    }
  })

  it('marks fully out-of-range pages instead of replacing them', () => {
    expect(narrowPageSelection(new Set([50, 60]), 3)).toMatchObject({ pagesSet: new Set(), pagesLabel: '', fullyOutOfRange: true, outOfRange: [50, 60] })
    expect(narrowPageSelection(new Set([2, 60]), 3)).toMatchObject({ pagesSet: new Set([2]), pagesLabel: '2', fullyOutOfRange: false, outOfRange: [60] })
  })
})
