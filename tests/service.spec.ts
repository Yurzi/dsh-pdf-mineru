import { chmod, readFile, writeFile } from 'node:fs/promises'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { asCacheKey } from '../src/domain/ids.js'
import type { MinerUResultManifest } from '../src/domain/result.js'
import { DOCUMENT_INDEX_VERSION } from '../src/reader/document-index.js'
import { extractMarkdownHeadings, formatTocMarkdown } from '../src/reader/projection.js'
import { READ_CURSOR_VERSION, cursorForRemainder, decodeReadCursor } from '../src/reader/read-cursor.js'
import type { ContentListBlock, DocumentHeading } from '../src/reader/views.js'
import { renderResult } from '../src/tools/render.js'
import { safeStringSlice, truncateAtCleanBoundary } from '../src/utils/text.js'
import { readerHarness, type FakeProvider } from './support/reader-harness.js'
import { toolHarness } from './support/tool-harness.js'

const renderedText = (view: Parameters<typeof renderResult>[0]): string =>
  renderResult(view).map(block => block.type === 'text' ? block.text : '').join('')

describe('ParseService publication', () => {
  it('maps a provider probe without creating parse state', async () => {
    const h = await readerHarness()
    await expect(h.parser.probe(h.config, new AbortController().signal)).resolves.toEqual({
      available: true, provider: h.provider.id, authentication: 'not-configured', protocol_version: 'fake',
    })
    expect(h.provider.submitCount).toBe(0)
    expect(h.operations.activeOperationCount()).toBe(0)
  })

  it('publishes once, then serves the cache without another Provider call or job id', async () => {
    const h = await readerHarness()
    const first = await h.read()
    expect(first).toMatchObject({ state: 'completed', source: 'provider', cache_hit: false })
    const second = await h.read()
    expect(second).toMatchObject({ state: 'completed', source: 'cache', cache_hit: true, result_id: first.result_id })
    for (const view of [first, second]) expect(view).not.toHaveProperty('job_id')
    expect(h.provider.submitCount).toBe(1)
    expect(h.provider.retry).toMatchObject({ maxRetries: h.config.retry.maxAttempts - 1, initialDelayMs: h.config.retry.baseDelayMs })

    // Provider retry hooks become typed diagnostics without local paths.
    h.provider.retry?.onRetry?.({ provider: h.provider.id, operation: 'inspect', attempt: 1, maxRetries: 2, delayMs: 500, reason: 'transport' })
    expect(h.diagnostics).toContainEqual(expect.objectContaining({ phase: 'provider-retry', providerOperation: 'inspect', maxAttempts: 3 }))
    expect(h.diagnostics).toContainEqual(expect.objectContaining({ phase: 'cache-hit' }))
    expect(JSON.stringify(h.diagnostics)).not.toContain(h.root)
  })

  it('releases a created reservation when the second cache check fails', async () => {
    const h = await readerHarness()
    const original = h.results.get.bind(h.results)
    let reads = 0
    const get = vi.spyOn(h.results, 'get').mockImplementation(async (...args) => {
      if (++reads === 2) throw new Error('second cache read failed')
      return await original(...args)
    })
    await expect(h.read()).rejects.toThrow('second cache read failed')
    expect(h.operations.activeOperationCount()).toBe(0)
    expect(h.provider.submitCount).toBe(0)

    get.mockRestore()
    expect((await h.read()).state).toBe('completed')
    expect(h.provider.submitCount).toBe(1)
  })

  it.each([
    { name: 'remote file failure', script: (p: FakeProvider) => { p.failedNames.add('input.pdf') }, code: 'REMOTE_PARSE_FAILED' },
    { name: 'missing required Markdown', script: (p: FakeProvider) => { p.omitMarkdown = true }, code: 'PROVIDER_UNAVAILABLE' },
  ])('fails closed on $name without publishing', async ({ script, code }) => {
    const h = await readerHarness()
    script(h.provider)
    await expect(h.read()).rejects.toMatchObject({ failure: { code } })
    expect(h.operations.activeOperationCount()).toBe(0)
    // Nothing was cached: the next request starts a fresh producer.
    await expect(h.read()).rejects.toMatchObject({ failure: { code } })
    expect(h.provider.submitCount).toBe(2)
  })
})

describe('shared producer', () => {
  it('coalesces concurrent reads to one upstream producer', async () => {
    const h = await readerHarness()
    const gate = h.provider.holdSubmit()
    const first = h.read()
    await gate.entered
    const second = h.read()
    const [operation] = h.operations.reserved
    await vi.waitFor(() => expect(operation!.waiterCount).toBe(2))
    gate.release()
    const views = await Promise.all([first, second])
    expect(new Set(views.map(view => view.source))).toEqual(new Set(['provider', 'shared-operation']))
    expect(h.operations.reserved).toHaveLength(1)
    expect(h.provider.submitCount).toBe(1)
  })

  it('does not cancel the shared producer when one waiting caller aborts', async () => {
    const h = await readerHarness()
    const gate = h.provider.holdSubmit()
    const kept = h.read()
    await gate.entered
    const controller = new AbortController()
    const cancelled = h.read({}, { signal: controller.signal })
    const [operation] = h.operations.reserved
    await vi.waitFor(() => expect(operation!.waiterCount).toBe(2))
    controller.abort(new DOMException('Caller stopped waiting', 'AbortError'))
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    expect(operation!.waiterCount).toBe(1)
    expect(operation!.controller.signal.aborted).toBe(false)
    gate.release()
    expect((await kept).state).toBe('completed')
    expect(h.provider.submitCount).toBe(1)
  })

  it('throws POLL_TIMEOUT and lets a later caller rejoin the running producer', async () => {
    const h = await readerHarness()
    const gate = h.provider.holdSubmit()
    await expect(h.read({ poll_timeout_ms: 10 })).rejects.toMatchObject({ failure: { code: 'POLL_TIMEOUT', retryable: true } })
    const [operation] = h.operations.reserved
    expect(operation!.controller.signal.aborted).toBe(false)

    const rejoined = h.read()
    await vi.waitFor(() => expect(operation!.waiterCount).toBe(1))
    gate.release()
    expect(await rejoined).toMatchObject({ state: 'completed', source: 'shared-operation' })
    expect(h.operations.reserved).toHaveLength(1)
    expect(h.provider.submitCount).toBe(1)
  })

  it('holds the shared storage lease for both the reader and the producer it started', async () => {
    const h = await readerHarness()
    const gate = h.provider.holdSubmit()
    const summary = h.summarize()
    await gate.entered
    expect(h.accessGate.activeReaderCount).toBe(2)
    gate.release()
    await expect(summary).resolves.toMatchObject({ source: 'provider' })
    expect(h.accessGate.activeReaderCount).toBe(0)
  })
})

describe('parse synopsis', () => {
  it('reports bounded invocation phases and skips waiting on a cache hit', async () => {
    const h = await readerHarness()
    const phases: string[] = []
    await h.summarize({ onProgress: phase => { phases.push(phase) } })
    expect(phases).toEqual(['preparing', 'waiting-for-parse', 'reading-result', 'summarizing'])
    phases.length = 0
    await h.summarize({ onProgress: phase => { phases.push(phase) } })
    expect(phases).toEqual(['preparing', 'reading-result', 'summarizing'])
    // A failing observer is not a parse failure and cannot restart a Provider.
    await expect(h.summarize({ onProgress: () => { throw new Error('observer failed') } })).resolves.toMatchObject({ cache_hit: true })
    expect(h.provider.submitCount).toBe(1)
  })

  it('summarizes Markdown above the reader bound without reading it, while content reads fail closed', async () => {
    const h = await readerHarness()
    await h.summarize()
    // Report the published Markdown above the reader's 64 MiB bound without writing 64 MiB.
    const original = h.results.get.bind(h.results)
    vi.spyOn(h.results, 'get').mockImplementation(async (...args): Promise<MinerUResultManifest | undefined> => {
      const manifest = await original(...args)
      if (manifest === undefined) return undefined
      const [file] = manifest.files
      return { ...manifest, files: [{ ...file, artifacts: file.artifacts.map(item => item.kind === 'markdown' ? { ...item, bytes: 64 * 1024 * 1024 + 1 } : item) }] }
    })
    const result = await h.summarize()
    expect(result).toMatchObject({ content_status: 'not_requested', cache_hit: true })
    expect(result).not.toHaveProperty('markdown_content')
    await expect(h.read()).rejects.toMatchObject({ failure: { code: 'RESULT_TOO_LARGE' } })
    expect(h.provider.submitCount).toBe(1)
  })

  it('returns unknown counts when there is no structured index', async () => {
    const h = await readerHarness()
    h.provider.markdown = '# Heading\n<table><tr><td>Table</td></tr></table>\n![Figure](figure.png)'
    const result = await h.summarize()
    expect(result.state).toBe('completed')
    expect(result.summary).toBeUndefined()
    expect(result).not.toHaveProperty('markdown_content')
  })

  it('skips an index above the synopsis budget without making parsed content unreadable', async () => {
    const h = await readerHarness()
    h.provider.contentList = [{ type: 'text', page_idx: 0, text: 'x'.repeat(2 * 1024 * 1024) }]
    const result = await h.summarize()
    expect(result.summary).toBeUndefined()
    expect(result.warnings).toHaveLength(1)
    const read = await h.read({ focus: 'text' })
    expect(read.markdown_content).toMatch(/^\[mr_[^\]]+:b1 · Page 1\]\n\nx+/)
    expect(read.content_status).toBe('partial')
    expect(h.provider.submitCount).toBe(1)
  })

  it('degrades malformed optional summary metadata but does not hide cache corruption', async () => {
    const h = await readerHarness()
    h.provider.contentList = '{}'
    const result = await h.summarize()
    expect(result.summary).toBeUndefined()
    expect(result.warnings).toHaveLength(1)
    await expect(h.read()).rejects.toMatchObject({ failure: { code: 'INVALID_REQUEST' } })

    const stored: { cacheKey: string } = JSON.parse(await readFile(result.manifest_path!, 'utf8'))
    const key = asCacheKey(stored.cacheKey)
    const manifest = (await h.results.get(key))!
    const markdown = manifest.files[0].artifacts.find(item => item.kind === 'markdown')!
    const path = h.results.resolveArtifactAbsolutePath(key, markdown.relativePath)
    await chmod(path, 0o600)
    await writeFile(path, 'changed cached body')
    await expect(h.summarize()).rejects.toMatchObject({ failure: { code: 'CACHE_CORRUPT' } })
  })

  it('bounds synopsis headings and titles while preserving known counts', async () => {
    const h = await readerHarness()
    h.provider.contentList = [
      ...Array.from({ length: 40 }, (_, page_idx) => ({ type: 'text', text_level: 1, page_idx, text: 'Title ' + '😀'.repeat(300) })),
      { type: 'table', page_idx: 39, table_body: '<table></table>' },
    ]
    const result = await h.summarize()
    expect(result.summary).toMatchObject({ page_count: 40, table_count: 1 })
    expect(result.summary!.toc).toHaveLength(20)
    for (const heading of result.summary!.toc!) {
      expect(heading.title.length).toBeLessThanOrEqual(160)
      expect(heading.title.isWellFormed()).toBe(true)
      expect(heading.line).toBeUndefined()
    }
    // The shortened outline is announced rather than presented as complete.
    expect(result.warnings).toHaveLength(1)
  })
})

describe('content reads', () => {
  it.each([
    { name: 'a short document', markdown: '# Complete Document Content\nFull text delivered.' },
    { name: 'a valid empty document', markdown: '' },
  ])('delivers $name completely without a cursor', async ({ markdown }) => {
    const h = await readerHarness()
    h.provider.markdown = markdown
    const view = await h.read()
    expect(view).toMatchObject({ state: 'completed', content_status: 'complete', cursor: null, markdown_content: markdown })
  })

  it('omits secondary artifacts unless focus requests them', async () => {
    const h = await readerHarness()
    h.provider.markdown = '# Essential Text\nContent'
    h.provider.extras = [{ kind: 'layout', content: JSON.stringify({ data: 'layout' }) }]
    const text = await h.read()
    expect(text.markdown_content).toContain('Essential Text')
    expect(text.files[0]!.artifacts).toEqual([])
    expect(text).not.toHaveProperty('markdown_path')
    expect(text).not.toHaveProperty('manifest_path')

    const artifacts = await h.read({ focus: 'artifacts' })
    expect(artifacts).toMatchObject({ content_status: 'not_requested', cursor: null })
    expect(artifacts.markdown_content).toBeUndefined()
    expect(artifacts.files[0]!.artifacts.map(item => item.kind)).toEqual(expect.arrayContaining(['markdown', 'layout', 'images']))
  })

  it('prioritizes text over secondary artifacts when the budget is tight', async () => {
    const h = await readerHarness({ output: { maxInlineChars: 2048 } })
    h.provider.markdown = '# Essential Text\n' + 'Important content.\n'.repeat(50)
    h.provider.images = Array.from({ length: 30 }, (_, index) => ({ relativeName: 'images/i' + String(index) + '.png' }))
    const view = await h.read({ focus: ['all', 'artifacts'] })
    expect(view.markdown_content).toContain('Essential Text')
    expect(view.files[0]!.artifacts_truncated).toBe(true)
    expect(JSON.stringify(view).length).toBeLessThanOrEqual(2048)
  })

  it('throws RESULT_TOO_LARGE when metadata alone exceeds the configured limit', async () => {
    const h = await readerHarness({ output: { maxInlineChars: 50 } })
    await expect(h.read()).rejects.toMatchObject({ failure: { code: 'RESULT_TOO_LARGE' } })
  })

  it('bounds JSON and rendered output together and advertises a cursor for the remainder', async () => {
    const h = await readerHarness({ output: { maxInlineChars: 2048 } })
    h.provider.markdown = '# Full Story\n' + 'Paragraph here.\n'.repeat(1500)
    const view = await h.read()
    expect(view.content_status).toBe('partial')
    expect(typeof view.cursor).toBe('string')
    expect(JSON.stringify(view).length).toBeLessThanOrEqual(2048)
    expect(renderedText(view).length).toBeLessThanOrEqual(2048)
  })

  it('continues selected Unicode text through read_pdf with exact advancing chunks and bounded output', async () => {
    const h = await readerHarness({ output: { maxInlineChars: 2048 } })
    // Long unbroken astral runs force cuts within text, not just at paragraph boundaries.
    // Quotes, backslashes, and newlines also exercise JSON escaping overhead.
    const selectedBlocks = ['😀'.repeat(1600) + ' first end', '第二段 "quoted" \\ path\n' + '🧪界'.repeat(1200) + ' final end']
    h.provider.markdown = 'UNSELECTED raw Markdown must not leak into continuation'
    h.provider.contentList = [
      { type: 'text', text: 'UNSELECTED first page', page_idx: 0 },
      { type: 'text', text: selectedBlocks[0], page_idx: 1 },
      { type: 'table', table_body: 'UNSELECTED table on selected page', page_idx: 1 },
      { type: 'text', text: selectedBlocks[1], page_idx: 2 },
      { type: 'text', text: 'UNSELECTED last page', page_idx: 3 },
    ]
    const t = await toolHarness({ reader: { readContent: h.reader.readContent.bind(h.reader) }, config: () => h.config })
    const schema = t.tool('read_pdf').output.schema
    const limit = h.config.output.maxInlineChars
    let args: Record<string, unknown> = { file_path: h.file, pages: '2-3', focus: 'text', inline_images: false }
    const chunks: string[] = []
    const cursors = new Set<string>()
    let offset = 0
    let expectedText = ''
    let complete = false
    // Bound the loop so a stuck or cycling cursor fails deterministically.
    for (let attempt = 0; attempt < 100 && !complete; attempt++) {
      const view = await t.read(args)
      const resultId = view.result_id
      expectedText ||= '[' + resultId + ':b2 · Page 2]\n\n' + selectedBlocks[0] + '\n\n[' + resultId + ':b4 · Page 3]\n\n' + selectedBlocks[1]
      expect(view).toMatchObject({ pages: '2-3', source: attempt === 0 ? 'provider' : 'cache', output_limit_chars: limit })
      expect(validateJsonSchemaValue(schema, view, 'value')).toEqual([])
      const chunk = view.markdown_content!
      expect(chunk.length).toBeGreaterThan(0)
      expect(chunk).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/)
      expect(chunk).toBe(expectedText.slice(offset, offset + chunk.length))
      expect(JSON.stringify(view).length).toBeLessThanOrEqual(limit)
      const rendered = renderedText(view)
      expect(rendered.length).toBeLessThanOrEqual(limit)
      expect(rendered).toContain(chunk)
      chunks.push(chunk)
      if (view.content_status === 'complete') {
        expect(view.cursor).toBeNull()
        expect(offset + chunk.length).toBe(expectedText.length)
        complete = true
        continue
      }
      expect(view.content_status).toBe('partial')
      const cursor = view.cursor!
      expect(cursors.has(cursor)).toBe(false)
      cursors.add(cursor)
      const decoded = decodeReadCursor(cursor)
      expect(decoded).toMatchObject({ rid: resultId, pages: '2-3', focus: ['text'], off: offset + chunk.length })
      offset = decoded.off
      // The cursor alone must restore both pages and focus on every continuation.
      args = { file_path: h.file, cursor }
    }
    expect(complete).toBe(true)
    expect(chunks.length).toBeGreaterThan(2)
    expect(chunks.join('')).toBe(expectedText)
    expect(h.provider.submitCount).toBe(1)
    expect(h.provider.collectCount).toBe(1)
  })

  it('rejects continuation for another result or a split character without reparsing', async () => {
    const h = await readerHarness({ output: { maxInlineChars: 2048 } })
    h.provider.markdown = '😀'.repeat(3000)
    const first = await h.read()
    expect(first.content_status).toBe('partial')
    const payload = decodeReadCursor(first.cursor!)
    const wrongIdentity = cursorForRemainder('mr_other_result', undefined, new Set(['all']), payload.off)
    await expect(h.read({ cursor: wrongIdentity })).rejects.toMatchObject({ failure: { code: 'INVALID_REQUEST', message: expect.stringMatching(/result identity does not match/) } })
    // Even a structurally valid token cannot resume halfway through a surrogate pair.
    const splitCharacter = cursorForRemainder(first.result_id, undefined, new Set(['all']), 1, { projection: payload.projection })
    await expect(h.read({ cursor: splitCharacter })).rejects.toThrow(/splits a Unicode character/)
    expect(h.provider.submitCount).toBe(1)
    expect(h.provider.collectCount).toBe(1)
  })

  it('resumes a published result even when caching is disabled for new requests', async () => {
    const h = await readerHarness()
    h.provider.contentList = [{ type: 'text', page_idx: 0, text: 'Block for cacheEnabled false test. ' + 'fill '.repeat(2500) }]
    const initial = await h.read()
    expect(initial.content_status).toBe('partial')
    h.configure({ cacheEnabled: false })
    const next = await h.read({ cursor: initial.cursor })
    expect(next.markdown_content!.length).toBeGreaterThan(0)
    expect(h.provider.submitCount).toBe(1)
  })
})

describe('outline and page scoping', () => {
  const outlineBlocks: ContentListBlock[] = [
    { type: 'title', text: 'Overview', text_level: 1, page_idx: 0 },
    { type: 'text', text: 'Some long paragraph text that should not appear in toc-only view.', page_idx: 0 },
    { type: 'text', text: 'Section 1', text_level: 2, page_idx: 1 },
    { type: 'image', path: 'images/fig1.png', page_idx: 1 },
    { type: 'text', text: 'Section 2', text_level: 2, page_idx: 2 },
  ]

  it('omits the repeated toc on partial reads and provides it on demand', async () => {
    const h = await readerHarness({ output: { maxInlineChars: 2048 } })
    h.provider.markdown = ['# Document Title', 'Intro.', '## Chapter 1', 'Paragraph 1. '.repeat(100), '### Section 1.1', 'Paragraph 2. '.repeat(100)].join('\n')
    const parsed = await h.read()
    expect(parsed.content_status).toBe('partial')
    expect(parsed.toc).toBeUndefined()
    const outline = await h.read({ focus: 'toc' })
    expect(outline.markdown_content).toBe(formatTocMarkdown(extractMarkdownHeadings(h.provider.markdown)))
  })

  it('returns an outline-only projection from the content list', async () => {
    const h = await readerHarness()
    h.provider.contentList = outlineBlocks
    const view = await h.read({ focus: 'toc' })
    expect(view).toMatchObject({ content_status: 'complete', cursor: null })
    expect(view.markdown_content).toContain('- Overview (Page 1)')
    expect(view.markdown_content).toContain('  - Section 1 (Page 2)')
    expect(view.markdown_content).toContain('  - Section 2 (Page 3)')
    expect(view.markdown_content).not.toContain('Some long paragraph text')
    expect(view.ordered_images).toBeUndefined()
    expect(view.toc).toBeUndefined()
    expect(view).not.toHaveProperty('pages')
  })

  it('filters the outline by pages and combines it with text when requested', async () => {
    const h = await readerHarness()
    h.provider.contentList = outlineBlocks
    const page2 = await h.read({ pages: '2', focus: 'toc' })
    expect(page2.markdown_content).toContain('  - Section 1 (Page 2)')
    expect(page2.markdown_content).not.toMatch(/Overview|Section 2/)
    const combined = await h.read({ pages: '1', focus: ['toc', 'text'] })
    expect(combined.markdown_content).toContain('- Overview (Page 1)')
    expect(combined.markdown_content).toContain('Some long paragraph text')
  })

  it('extracts the outline from Markdown when there is no content list', async () => {
    const h = await readerHarness()
    h.provider.markdown = '# Fallback Title\nSome body text\n## Sub Heading\nMore body'
    const view = await h.read({ focus: 'toc' })
    expect(view.markdown_content).toContain('- Fallback Title (line 1)')
    expect(view.markdown_content).toContain('  - Sub Heading (line 3)')
    expect(view.markdown_content).not.toContain('Some body text')
  })

  it.each([{ focus: 'text' as const }, { pages: '1' }, { query: 'Doc' }])('rejects typed selection %o when Markdown has no content-list mapping', async args => {
    const h = await readerHarness()
    h.provider.markdown = '# Doc\n| A | B |\n|---|---|\n| 1 | 2 |'
    await expect(h.read(args)).rejects.toMatchObject({ failure: { code: 'INVALID_REQUEST', message: expect.stringContaining('[SELECTION_UNAVAILABLE]') } })
  })

  it('lists only images located on the selected pages', async () => {
    const h = await readerHarness()
    h.provider.contentList = [
      { type: 'text', text: 'Page 1 intro.', page_idx: 0 },
      { type: 'image', path: 'images/page1.png', caption: 'Figure 1 on Page 1', page_idx: 0 },
      { type: 'image', path: 'images/page2.png', caption: 'Figure 2 on Page 2', page_idx: 1 },
      { type: 'text', text: 'Page 3 content without images.', page_idx: 2 },
    ]
    const page2 = await h.read({ pages: '2' })
    expect(page2.ordered_images).toEqual([expect.objectContaining({ status: 'unavailable', page: 2, caption: 'Figure 2 on Page 2' })])
    expect(page2.markdown_content).not.toContain('Figure 1 on Page 1')
    expect((await h.read({ pages: '3' })).ordered_images).toBeUndefined()
  })

  it('reports layout page bounds instead of silently narrowing out-of-range pages', async () => {
    const h = await readerHarness()
    h.provider.contentList = [0, 1, 2].map(page_idx => ({ type: 'text', text: 'Page ' + String(page_idx + 1) + ' text content.', page_idx }))
    h.provider.extras = [{ kind: 'layout', content: JSON.stringify({ pdf_info: [{ page_idx: 0 }, { page_idx: 1 }, { page_idx: 2 }] }) }]
    await expect(h.read({ pages: '50-60' })).rejects.toMatchObject({ failure: { code: 'INVALID_REQUEST', message: expect.stringMatching(/^\[PAGE_OUT_OF_RANGE\].*valid: 1-3/) } })
    const inBounds = await h.read({ pages: '1-2' })
    expect(inBounds).toMatchObject({ pages: '1-2', content_status: 'complete', summary: { page_count: 3, page_count_source: 'layout' } })
    expect(inBounds.markdown_content).toContain('Page 2 text content')
    expect(inBounds.markdown_content).not.toContain('Page 3 text content')
    const all = await h.read()
    expect(all).not.toHaveProperty('pages')
    expect(all.summary).toMatchObject({ page_count: 3, page_count_source: 'layout' })
  })
})

describe('scoped evidence diagnostics and budgets', () => {
  it('scopes diagnostics to TOC, table, query and exact blocks without renumbering', async () => {
    const h = await readerHarness()
    h.provider.contentList = [
      { type: 'text', text: 'Methods', text_level: 1, page_idx: 0 },
      { type: 'unknown-widget', text: 'unsupported but retained', page_idx: 0 },
      { type: 'table', table_body: '<table><tr><td>42</td></tr></table>', page_idx: 0 },
      { type: 'text', text: '其中， 表示可训练参数', page_idx: 1 },
    ]
    expect((await h.read({ focus: 'toc' })).diagnostics ?? []).toEqual([])
    expect((await h.read({ focus: 'table', pages: 1 })).diagnostics?.filter(d => d.scope === 'chunk') ?? []).toEqual([])
    const query = await h.read({ query: '其中' })
    expect(query.diagnostics).toEqual([expect.objectContaining({ code: 'DOCUMENT_INDEX_POSSIBLE_TEXT_GAP', scope: 'chunk', block_id: query.result_id + ':b4', page: 2 })])
    expect((await h.read({ block_id: query.result_id + ':b4' })).diagnostics).toEqual(query.diagnostics)
    expect((await h.read({ block_id: query.result_id + ':b2' })).diagnostics?.[0]?.code).toBe('DOCUMENT_INDEX_UNKNOWN_BLOCK_TYPE')
  })

  it('returns all reference entries and finds a later list item without reparsing', async () => {
    const h = await readerHarness()
    const references = Array.from({ length: 15 }, (_, index) => '[' + String(index + 1) + '] Reference author ' + String(index + 1))
    h.provider.contentList = [{ type: 'list', sub_type: 'ref_text', list_items: references, page_idx: 16 }]
    const first = await h.read()
    for (const reference of references) expect(first.markdown_content).toContain(reference)
    expect(first.diagnostics ?? []).toEqual([])
    const found = await h.read({ query: 'author 15' })
    expect(found.markdown_content).toContain(first.result_id + ':b1')
    expect(found.markdown_content).toContain('author 15')
    expect(h.provider.submitCount).toBe(1)
  })

  it('never rewrites suspect mathematics and reports provenance separately from reader versions', async () => {
    const h = await readerHarness()
    const formula = String.raw`$$ P  Q \equiv \lnot P \times Q \tag{7} $$`
    h.provider.contentList = [{ type: 'equation', text: formula, page_idx: 6 }]
    const result = await h.read()
    expect(result.markdown_content).toContain(formula)
    expect(result.verification_hints).toEqual([{ reason: 'formula', block_id: result.result_id + ':b1', page: 7, view: 'page' }])
    expect(result.diagnostics ?? []).toEqual([])
    expect(result.provenance).toMatchObject({
      provider: h.provider.id, model: h.config.defaults.model, upstream_version: null,
      index_version: DOCUMENT_INDEX_VERSION, reader_version: READ_CURSOR_VERSION,
    })
  })

  it('adds original-page hints for every accepted top-level equation kind', async () => {
    const h = await readerHarness()
    const blocks = ['equation', 'Equation', 'interline_equation', 'INLINE_EQUATION'].map(type => ({ type, content: 'x', page_idx: 0 }))
    h.provider.contentList = blocks
    const view = await h.read()
    expect(view.verification_hints?.map(hint => hint.block_id)).toEqual(blocks.map((_, index) => view.result_id + ':b' + String(index + 1)))
  })

  it('emits only delivered-chunk diagnostics on continuations and never replays scope notices', async () => {
    const h = await readerHarness()
    h.provider.contentList = Array.from({ length: 15 }, (_, index) => ({ type: 'unknown-widget', text: 'Block ' + String(index) + ' ' + 'x'.repeat(1700), page_idx: 0 }))
    let view = await h.read({ pages: 1, inline_images: false })
    expect(view.provenance).toBeDefined()
    expect(view.diagnostics?.some(d => d.scope === 'selection')).toBe(true)
    for (let count = 0; count < 20; count++) {
      for (const diagnostic of view.diagnostics ?? []) {
        if (diagnostic.scope !== 'chunk') continue
        expect(view.markdown_content?.includes('[' + diagnostic.block_id) || view.continuation_block?.block_id === diagnostic.block_id).toBe(true)
      }
      if (!view.cursor) break
      view = await h.read({ cursor: view.cursor })
      expect(view.provenance).toBeUndefined()
      expect(view.diagnostics?.some(d => d.scope !== 'chunk') ?? false).toBe(false)
      expect(view.warnings?.some(warning => warning.includes('PAGE_COUNT_LOWER_BOUND')) ?? false).toBe(false)
    }
    expect(view.content_status).toBe('complete')
  })

  it('preserves initial selection notices when one block has many diagnostics', async () => {
    const h = await readerHarness()
    h.provider.contentList = [{ type: 'list', list_items: ['[1] Valid', ...Array.from({ length: 20 }, () => ({ unsupported: true }))], page_idx: 0 }]
    const view = await h.read({ pages: 1 })
    expect(view.diagnostics?.[0]).toMatchObject({ scope: 'selection', code: 'PAGE_COUNT_LOWER_BOUND' })
    expect(view.diagnostics?.some(diagnostic => diagnostic.scope === 'chunk')).toBe(true)
    expect(view.metadata_shortened).toContain('diagnostics')
    expect(view.diagnostics!.length).toBeLessThanOrEqual(6)
  })

  it('makes progress under the minimum budget with explicit metadata degradation', async () => {
    const h = await readerHarness({ output: { maxInlineChars: 1024 } })
    h.provider.contentList = [{ type: 'unknown-widget', text: '其中， 表示可训练参数 ' + 'x'.repeat(1600), page_idx: 0 }]
    let view = await h.read()
    expect(view.metadata_shortened?.length).toBeGreaterThan(0)
    for (let rounds = 0; view.cursor && rounds < 40; rounds++) {
      expect(JSON.stringify(view).length).toBeLessThanOrEqual(1024)
      expect(renderedText(view).length).toBeLessThanOrEqual(1024)
      expect(view.markdown_content!.length).toBeGreaterThan(0)
      view = await h.read({ cursor: view.cursor })
    }
    expect(view.content_status).toBe('complete')
  })

  it('compacts optional metadata for artifact-only reads under a small budget', async () => {
    const h = await readerHarness({ output: { maxInlineChars: 1024 } })
    const file = await h.addSource('r'.repeat(180) + '.pdf')
    h.provider.contentList = [{ type: 'text', text: 'content', page_idx: 0 }]
    const view = await h.read({ focus: 'artifacts' }, { file })
    expect(view.content_status).toBe('not_requested')
    expect(view.metadata_shortened?.length).toBeGreaterThan(0)
    expect(view.files[0]!.artifacts_truncated).toBe(true)
    expect(JSON.stringify(view).length).toBeLessThanOrEqual(1024)
    expect(renderedText(view).length).toBeLessThanOrEqual(1024)
  })
})

describe('projection text helpers', () => {
  it.each([
    { name: 'empty text', text: '', expected: [] },
    { name: 'plain text', text: 'Just plain text\nNo hashes here', expected: [] },
    {
      name: 'levels 1-6 with trimmed titles', text: '# Main Title\nIntro\n## Section 1 \n### Sub\n#### H4\n##### H5\n###### H6',
      expected: [[1, 'Main Title', 1], [2, 'Section 1', 3], [3, 'Sub', 4], [4, 'H4', 5], [5, 'H5', 6], [6, 'H6', 7]],
    },
    {
      name: 'invalid syntax and CRLF', text: '####### Seven\r\n#NoSpace\r\n### \t Tab after hash\r\n###    \r\n# Valid Heading\r\n## Second Heading',
      expected: [[3, 'Tab after hash', 3], [1, 'Valid Heading', 5], [2, 'Second Heading', 6]],
    },
  ] as const)('extracts Markdown headings from $name', ({ text, expected }) => {
    expect(extractMarkdownHeadings(text)).toEqual(expected.map(([level, title, line]) => ({ level, title, line })))
  })

  it('keeps every heading without a summary cap', () => {
    const text = Array.from({ length: 50 }, (_, index) => '#'.repeat(index % 3 + 1) + ' Title ' + String(index)).join('\n')
    expect(extractMarkdownHeadings(text)).toHaveLength(50)
  })

  it('formats outline Markdown with level indentation and page or line coordinates', () => {
    const headings: DocumentHeading[] = [{ level: 1, title: 'Introduction', page: 1 }, { level: 2, title: 'Background', line: 4 }, { level: 3, title: 'Details' }]
    expect(formatTocMarkdown(headings)).toBe('# Document Outline\n\n- Introduction (Page 1)\n  - Background (line 4)\n    - Details')
    expect(formatTocMarkdown([])).not.toContain('- ')
    expect(formatTocMarkdown([], { pageRange: '3-5' })).toContain('3-5')
  })

  it.each([
    { text: 'First line\nSecond line\nThird line', max: 22, expected: 'First line\n' },
    { text: 'Paragraph 1\n\nParagraph 2\n\nParagraph 3', max: 16, expected: 'Paragraph 1\n\n' },
    { text: 'Paragraph 1\n\nParagraph 2\n\nParagraph 3', max: 25, expected: 'Paragraph 1\n\nParagraph 2\n' },
    { text: '第一段中文\n第二段中文内容更长一些\n第三段', max: 16, expected: '第一段中文\n' },
  ])('truncates at a clean boundary within $max characters', ({ text, max, expected }) => {
    expect(truncateAtCleanBoundary(text, max)).toMatchObject({ truncated: true, text: expected })
  })

  it('never slices through a surrogate pair', () => {
    expect(safeStringSlice('A🚀B', 2)).toBe('A')
  })
})
