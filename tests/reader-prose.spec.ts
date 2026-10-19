import { describe, expect, it } from 'vitest'
import { formatResultProse, formatSingleSummaryProse } from '../src/reader/prose.js'
import type { ContentStatus } from '../src/reader/views.js'
import { renderResult } from '../src/tools/render.js'
import { imageCandidate, inlinedImage, resultFile, resultView, summaryView } from './support/views.js'

// Model-visible prose semantics. Sentences are free to change; these invariants are not.
const textOf = (blocks: ReturnType<typeof renderResult>): string => blocks[0]?.type === 'text' ? blocks[0].text : ''

describe('read_pdf prose', () => {
  it.each([
    ['complete', null], ['not_requested', null], ['partial', 'opaque-cursor-token'],
  ] as const)('advertises a continuation cursor iff the result is partial (%s)', (content_status: ContentStatus, cursor) => {
    const prose = formatResultProse(resultView({
      content_status, cursor, markdown_content: content_status === 'not_requested' ? undefined : 'Evidence',
      toc: [{ level: 1, title: 'Introduction', page: 1 }],
    }))
    expect(prose.includes('opaque-cursor-token')).toBe(cursor !== null)
    expect(prose).not.toMatch(/cursor: "null"|undefined/)
    // Never claim complete delivery for partial or unrequested text.
    expect(/Content complete/.test(prose)).toBe(content_status === 'complete')
  })

  it('offers the outline for navigation only while text remains', () => {
    const toc = [{ level: 1, title: 'Introduction', page: 1 }, { level: 2, title: 'Without a location' }]
    const partial = formatResultProse(resultView({ content_status: 'partial', cursor: 'c', markdown_content: 'x', toc }))
    expect(partial).toContain('Introduction')
    expect(partial).toContain('Without a location')
    expect(partial).not.toMatch(/line undefined|line 0|Page undefined/)
    expect(formatResultProse(resultView({ markdown_content: 'x', toc }))).not.toContain('Without a location')
  })

  it('qualifies completion with the physical page count source and labels formula hints advisory', () => {
    const prose = formatResultProse(resultView({
      markdown_content: 'x', summary: { page_count: 3, page_count_source: 'content-list-lower-bound' },
      verification_hints: [{ reason: 'formula', block_id: 'mr_fixture:b2', page: 2, view: 'page' }],
    }))
    expect(prose).toMatch(/lower bound: 3/)
    expect(prose).toMatch(/not a guarantee of OCR fidelity/)
    expect(prose).toMatch(/advisory/)
    expect(prose).toContain('mr_fixture:b2')
    expect(prose).not.toMatch(/Diagnostics:/)
  })

  it('never exposes the manifest path and discloses artifact truncation', () => {
    const prose = formatResultProse(resultView({
      manifest_path: '/cache/secret/manifest.json',
      files: [resultFile({ artifacts: [{ kind: 'layout', path: '/cache/doc/layout.json', bytes: 200 }], artifacts_truncated: true })],
    }))
    expect(prose).not.toContain('manifest.json')
    expect(prose).toContain('/cache/doc/layout.json')
    expect(prose).toMatch(/truncated/i)
  })

  it('lists unattached images by path or block id with their delivery status', () => {
    const prose = formatResultProse(resultView({ ordered_images: [
      imageCandidate({ path: '/cache/images/one.png', page: 2, caption: 'Chart' }),
      imageCandidate({ path: '/cache/images/two.png', status: 'failed' }),
      imageCandidate({ path: '/cache/images/three.png', block_id: 'mr_fixture:b3', status: 'omitted' }),
    ] }))
    expect(prose).toContain('/cache/images/one.png')
    expect(prose).toMatch(/two\.png \[failed\]/)
    expect(prose).toContain('[mr_fixture:b3] [omitted]')
    expect(prose).not.toContain('/cache/images/three.png')
  })
})

describe('read_pdf rendering', () => {
  it('appends inlined images as attachment blocks after the text', () => {
    const blocks = renderResult(resultView({ inlined_images: [inlinedImage({ attachment_id: 'sha256:' + 'f'.repeat(64), media_type: 'image/jpeg', width: 640, height: 480, bytes: 65_432 })] }))
    expect(blocks.map(block => block.type)).toEqual(['text', 'image'])
    expect(blocks[1]).toEqual({ type: 'image', attachment: {
      attachmentId: 'sha256:' + 'f'.repeat(64), mediaType: 'image/jpeg', bytes: 65_432, width: 640, height: 480, name: 'figure.png',
    } })
  })

  it('replaces over-limit prose with an explicit too-large marker instead of a truncated complete footer', () => {
    const text = textOf(renderResult(resultView({ markdown_content: 'A'.repeat(5000), output_limit_chars: 150 })))
    expect(text.length).toBeLessThanOrEqual(150)
    expect(text).toContain('[RESULT_TOO_LARGE]')
    expect(text).not.toContain('complete')
  })
})

describe('async_parse_pdf summary prose', () => {
  it('names the document, reports only known counts and never claims body delivery', () => {
    const known = formatSingleSummaryProse(summaryView({ summary: { page_count: 5, table_count: 2 }, toc: [{ level: 1, title: 'Methods' }] }))
    expect(known).toContain('paper.pdf')
    expect(known).toMatch(/5/)
    expect(known).toContain('Methods')
    expect(known).not.toMatch(/Figures|Formulas/)
    const unknown = formatSingleSummaryProse(summaryView())
    expect(unknown).not.toMatch(/Total Pages|Tables/)
    expect(unknown).not.toMatch(/Content complete/)
  })
})
