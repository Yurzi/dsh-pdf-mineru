import { describe, expect, it } from 'vitest'
import type { ContentListBlock } from '../src/service/result-presenter.js'
import { extractDocumentLabel, normalizeDocumentBlocks } from '../src/service/document-index.js'

describe('document index', () => {
  it('assigns result-bound identities before selection and retains caption labels', () => {
    const source: ContentListBlock[] = [
      { type: 'text', page_idx: 0, text: '第一页' },
      { type: 'image', page_idx: 1, image_caption: '图 2：系统结构', img_path: 'images/a.png' },
      { type: 'table', page_idx: 1, table_caption: ['Table IV. Ablation', 'continued'], table_body: '<table></table>' },
      { type: 'equation', page_idx: 2, text: 'E=mc^2', caption: 'Eq. (7): energy' },
      { type: 'image', page_idx: 3, caption: 'Architecture without an original label', document_label: 'Figure 999' },
    ]

    const first = normalizeDocumentBlocks(source, 'mr_alpha')
    const second = normalizeDocumentBlocks(source, 'mr_beta')
    expect(first.blocks.map(block => block.block_id)).toEqual([
      'mr_alpha:b1', 'mr_alpha:b2', 'mr_alpha:b3', 'mr_alpha:b4', 'mr_alpha:b5',
    ])
    expect(first.blocks.map(block => block.document_order)).toEqual([1, 2, 3, 4, 5])
    expect(first.blocks.map(block => block.document_label)).toEqual([undefined, '图 2', 'Table IV', 'Eq. (7)', undefined])
    expect(second.blocks.map(block => block.block_id)).toEqual([
      'mr_beta:b1', 'mr_beta:b2', 'mr_beta:b3', 'mr_beta:b4', 'mr_beta:b5',
    ])

    // Page/focus selection happens after indexing, so it cannot renumber matches.
    expect(first.blocks.filter(block => block.page_idx === 1 && block.type === 'table')[0]?.block_id).toBe('mr_alpha:b3')
    expect(extractDocumentLabel({ type: 'equation', caption: '(12) Maxwell relation' })).toBe('(12)')
    expect(extractDocumentLabel({ type: 'text', caption: 'Figure 99 is discussed here' })).toBeUndefined()
  })

  it('reconstructs known MinerU lines/spans in exact inline order', () => {
    const source: ContentListBlock[] = [{
      type: 'text',
      page_idx: 0,
      lines: [
        {
          spans: [
            { type: 'text', content: '共有' },
            { type: 'inline_equation', content: '12' },
            { type: 'text', content: '个元素，符号' },
            { type: 'inline_equation', content: '\\alpha+\\beta' },
            { type: 'text', content: '保持顺序。' },
          ],
        },
        { spans: [{ type: 'text', content: '第二行 ± ∞ 中文。' }] },
      ],
    }]

    const result = normalizeDocumentBlocks(source, 'mr_math')
    expect(result.blocks[0]?.text).toBe('共有$12$个元素，符号$\\alpha+\\beta$保持顺序。\n第二行 ± ∞ 中文。')
    expect(result.warnings).toEqual([])
    expect(source[0]?.text).toBeUndefined()
  })

  it('does not append nested text when a flat text/content/code representation exists', () => {
    const lines = [{ spans: [{ type: 'text', content: 'DUPLICATE' }] }]
    const result = normalizeDocumentBlocks([
      { type: 'text', text: 'canonical text', lines },
      { type: 'text', content: 'canonical content', lines },
      { type: 'code', code: 'const n = 1', lines },
    ], 'mr_flat')

    expect(result.blocks[0]?.text).toBe('canonical text')
    expect(result.blocks[1]?.content).toBe('canonical content')
    expect(result.blocks[1]?.text).toBe('canonical content')
    expect(result.blocks[2]?.code).toBe('const n = 1')
    expect(result.blocks[0]?.lines).toBe(lines)
    expect(result.warnings).toEqual([
      '[DOCUMENT_INDEX_CONFLICTING_CONTENT] block 1: nonempty flat and nested text differ; flat content was kept',
      '[DOCUMENT_INDEX_CONFLICTING_CONTENT] block 2: nonempty flat and nested text differ; flat content was kept',
      '[DOCUMENT_INDEX_CONFLICTING_CONTENT] block 3: nonempty flat and nested text differ; flat content was kept',
    ])
  })

  it('recovers nested text from blank flat slots and diagnoses only substantive conflicts', () => {
    const result = normalizeDocumentBlocks([
      {
        type: 'text', text: '   ', content: '',
        lines: [{ spans: [{ type: 'text', content: '从嵌套 spans 恢复' }] }],
      },
      {
        type: 'text', text: 'flat authoritative',
        lines: [{ spans: [{ type: 'text', content: 'different nested value' }] }],
      },
      {
        type: 'text', text: '值 $x + 1$',
        lines: [{ spans: [
          { type: 'text', content: ' 值 ' },
          { type: 'inline_equation', content: 'x+1' },
        ] }],
      },
      {
        type: 'image', img_path: 'images/with-extra.png',
        lines: [{ spans: [{ type: 'text', content: 'extra image-associated text' }] }],
      },
    ], 'mr_precedence')

    expect(result.blocks[0]?.text).toBe('从嵌套 spans 恢复')
    expect(result.blocks[0]?.content).toBe('')
    expect(result.blocks[1]?.text).toBe('flat authoritative')
    expect(result.blocks[1]?.text).not.toContain('different nested value')
    expect(result.blocks[2]?.text).toBe('值 $x + 1$')
    expect(result.blocks[3]?.text).toBeUndefined()
    expect(result.warnings).toEqual([
      '[DOCUMENT_INDEX_CONFLICTING_CONTENT] block 2: nonempty flat and nested text differ; flat content was kept',
      '[DOCUMENT_INDEX_UNSUPPORTED_CONTENT] block 4: nonempty nested image text was not merged; verify the original page',
    ])
  })

  it('preserves nested code and equation strings without guessing non-string values', () => {
    const result = normalizeDocumentBlocks([
      {
        type: 'code', language: 'ts',
        lines: [{ spans: [{ type: 'code', content: 'const π = 3.14;' }] }],
      },
      {
        type: 'equation',
        lines: [{ spans: [{ type: 'equation', content: '\\sum_{i=1}^n i' }] }],
      },
      {
        type: 'text',
        lines: [{ spans: [
          { type: 'text', content: '数字对象不应被猜测：' },
          { type: 'inline_equation', content: 42 },
          { type: 'text', content: '结束' },
        ] }],
      },
    ], 'mr_kinds')

    expect(result.blocks[0]?.code).toBe('const π = 3.14;')
    expect(result.blocks[1]?.text).toBe('$$\\sum_{i=1}^n i$$')
    expect(result.blocks[2]?.text).toBe('数字对象不应被猜测：结束')
    expect(result.warnings.some(warning => warning.startsWith('[DOCUMENT_INDEX_UNSUPPORTED_CONTENT]'))).toBe(true)
    expect(JSON.stringify(result.blocks)).not.toContain('[object Object]')
  })

  it('preserves complex table HTML, captions, and footnotes byte-for-character', () => {
    const table: ContentListBlock = {
      type: 'table',
      table_body: '<table class="wide"><thead><tr><th rowspan="2">A &amp; B</th></tr></thead>\n<tbody><tr><td><math>x&lt;y</math></td></tr></tbody></table>',
      table_caption: ['表 3：复杂表格', '原始 caption 二'],
      table_footnote: ['* 保留 Markdown', '脚注 <raw>'],
      caption: 'fallback caption must also remain',
      footnote: 'fallback footnote must also remain',
    }
    const result = normalizeDocumentBlocks([table], 'mr_table')
    const indexed = result.blocks[0]!

    expect(indexed.table_body).toBe(table.table_body)
    expect(indexed.table_caption).toBe(table.table_caption)
    expect(indexed.table_footnote).toBe(table.table_footnote)
    expect(indexed.caption).toBe(table.caption)
    expect(indexed.footnote).toBe(table.footnote)
    expect(indexed.document_label).toBe('表 3')
    expect(result.warnings).toEqual([])
  })

  it('warns conservatively about observed Chinese empty-value slots without changing text', () => {
    const observed = [
      '22个文件中的 个函数契约子任务， 包含 个循环规约子任务',
      '两个模型的通过率为 和 ；',
    ]
    const result = normalizeDocumentBlocks([
      { type: 'text', text: observed[0] },
      { type: 'text', content: observed[1] },
      { type: 'text', text: '该数据集包含3个循环规约子任务。' },
      { type: 'text', text: '文中包含多个完整示例。' },
    ], 'mr_rx033_gap')

    expect(result.blocks[0]?.text).toBe(observed[0])
    expect(result.blocks[1]?.text).toBe(observed[1])
    expect(result.blocks[2]?.text).toBe('该数据集包含3个循环规约子任务。')
    expect(result.warnings).toEqual([
      '[DOCUMENT_INDEX_POSSIBLE_TEXT_GAP] block 1: possible missing value detected; verify the original page',
      '[DOCUMENT_INDEX_POSSIBLE_TEXT_GAP] block 2: possible missing value detected; verify the original page',
    ])
    expect(result.warnings.join('')).not.toContain('22个文件')
    expect(result.warnings.join('')).not.toContain('两个模型')
  })

  it('normalizes actual MinerU chart aliases and finds a later anchored figure label', () => {
    const chart: ContentListBlock = {
      type: 'chart',
      img_path: 'images/x.jpg',
      content: '',
      chart_caption: [
        '第一阶段：第二阶段训练占比',
        '图 7 不同阶段训练占比下 TSFT 模型的性能',
      ],
      chart_footnote: [],
      page_idx: 14,
    }

    const result = normalizeDocumentBlocks([chart], 'mr_rx033')
    const indexed = result.blocks[0]!
    expect(indexed.chart_caption).toBe(chart.chart_caption)
    expect(indexed.image_caption).toEqual([
      '第一阶段：第二阶段训练占比',
      '图 7 不同阶段训练占比下 TSFT 模型的性能',
    ])
    expect((indexed.image_caption as readonly string[]).join(' ')).toContain('不同阶段训练占比下 TSFT')
    expect(indexed.chart_footnote).toBe(chart.chart_footnote)
    expect(indexed.image_footnote).toEqual([])
    expect(indexed.document_label).toBe('图 7')
    expect(indexed.page_idx).toBe(14)
    expect(result.warnings).toEqual([])
  })

  it('sanitizes unknown types, captions, footnotes, paths, and supplied labels without coercion', () => {
    const secret = 'PRIVATE_METADATA_'.repeat(1_000)
    const result = normalizeDocumentBlocks([
      { type: secret, text: 'Known flat text still survives.' },
      {
        type: 'image',
        document_label: 'Figure 999',
        caption: { secret } as unknown as string,
        footnote: ['safe footnote', { secret }] as unknown as string[],
        chart_caption: ['safe chart caption', { secret }] as unknown as string[],
        chart_footnote: { secret } as unknown as string,
        img_path: { secret } as unknown as string,
        image_path: null as unknown as string,
        path: ['not', 'a path'] as unknown as string,
      },
      {
        type: 'image',
        img_caption: ['Figure 3: original MinerU alias'],
        img_footnote: ['alias footnote'],
        img_path: 'images/figure-3.png',
      },
    ], 'mr_metadata')

    expect(result.blocks[0]?.type).toBe(secret)
    expect(result.blocks[0]?.text).toBe('Known flat text still survives.')
    expect(result.warnings.some(warning => warning.startsWith('[DOCUMENT_INDEX_UNKNOWN_BLOCK_TYPE] block 1:'))).toBe(true)
    expect(result.blocks[1]?.document_label).toBeUndefined()
    expect(result.blocks[1]?.caption).toBeUndefined()
    expect(result.blocks[1]?.footnote).toEqual(['safe footnote'])
    expect(result.blocks[1]?.chart_caption).toEqual(['safe chart caption'])
    expect(result.blocks[1]?.image_caption).toEqual(['safe chart caption'])
    expect(result.blocks[1]?.chart_footnote).toBeUndefined()
    expect(result.blocks[1]?.img_path).toBeUndefined()
    expect(result.blocks[1]?.image_path).toBeUndefined()
    expect(result.blocks[1]?.path).toBeUndefined()
    expect(result.blocks[2]?.document_label).toBe('Figure 3')
    expect(result.blocks[2]?.image_caption).toEqual(['Figure 3: original MinerU alias'])
    expect(result.blocks[2]?.image_footnote).toEqual(['alias footnote'])
    expect(result.warnings.join('')).not.toContain('PRIVATE_METADATA_')
    expect(JSON.stringify(result.blocks[1])).not.toContain('[object Object]')
  })

  it('emits typed bounded warnings without leaking document strings', () => {
    const secret = 'PRIVATE_DOCUMENT_TEXT_'.repeat(1_000)
    const malformed: ContentListBlock[] = Array.from({ length: 40 }, (_, index) => ({
      type: 'text',
      lines: [{ spans: [{ type: index % 2 === 0 ? 'future_node' : 'inline_equation', content: index % 2 === 0 ? secret : { secret } }] }],
    }))
    malformed.push({ type: 'text', text: { secret } })

    const result = normalizeDocumentBlocks(malformed, 'mr_warn')
    expect(result.warnings).toHaveLength(20)
    expect(result.warnings.at(-1)).toMatch(/^\[DOCUMENT_INDEX_WARNINGS_OMITTED\] \d+ additional normalization warning\(s\) omitted\.$/)
    expect(result.warnings.every(warning => /^\[DOCUMENT_INDEX_[A-Z_]+\]/.test(warning))).toBe(true)
    expect(result.warnings.join('')).not.toContain('PRIVATE_DOCUMENT_TEXT_')
    expect(result.warnings.every(warning => warning.length < 240)).toBe(true)
    expect(result.blocks.at(-1)?.text).toBeUndefined()
    expect(JSON.stringify(result.blocks.at(-1))).not.toContain('[object Object]')
  })
})

it('keeps late critical gaps visible and scopes warnings without renumbering blocks', () => {
  const blocks = [...Array.from({ length: 40 }, () => ({ type: 'unrecognized', text: 'kept' })), { type: 'text', text: '包含 个任务', page_idx: 10 }]
  const all = normalizeDocumentBlocks(blocks, 'mr_test')
  expect(all.warnings[0]).toContain('POSSIBLE_TEXT_GAP')
  expect(all.warnings.length).toBeLessThanOrEqual(20)
  const selected = normalizeDocumentBlocks(blocks, 'mr_test', new Set([41]))
  expect(selected.blocks[40]?.block_id).toBe('mr_test:b41')
  expect(selected.warnings).toHaveLength(1)
  expect(selected.warnings[0]).toContain('block 41')
})

