import { chmod, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import util from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type { DefineToolOptions, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { defaultMinerUConfig, type MinerUConfig } from '../src/config.js'
import { MinerUError, failure } from '../src/domain/errors.js'
import type { CanonicalParseRequest, PreparedSourceFile } from '../src/domain/request.js'
import type {
  ArtifactSink,
  MinerUProvider,
  ProviderCallContext,
  ProviderCapabilities,
  ProviderCollection,
  ProviderCompatibilityContext,
  ProviderJobRef,
  ProviderJobSnapshot,
  ProviderProbeResult,
  ProviderSubmission,
} from '../src/providers/provider.js'
import { ProviderRegistry } from '../src/providers/registry.js'
import {
  MinerUService,
  type ContentListBlock,
  type ResultView,
  type ServiceSession,
} from '../src/service/mineru-service.js'
import {
  fitsReadBudget,
  MAX_MODEL_MARKDOWN_CHARS,
  MAX_MODEL_RESPONSE_BYTES,
} from '../src/service/read-delivery.js'
import {
  decodeReadCursor,
  encodeReadCursor,
  READ_CURSOR_VERSION,
} from '../src/service/read-cursor.js'
import { formatResultProse } from '../src/service/result-presenter.js'
import { registerTools } from '../src/tools.js'
import { SharedOperationRegistry } from '../src/service/shared-operations.js'
import { ResultRepository } from '../src/storage/result-repository.js'
import { StoragePaths } from '../src/storage/paths.js'

// --- Mock Provider & Harness ---

interface MockImageArtifact {
  readonly relativeName: string
  readonly data: Buffer
  readonly mediaType: string
}

class ModelReadingMockProvider implements MinerUProvider {
  readonly id = 'self-hosted-v2' as const
  readonly capabilities: ProviderCapabilities = {
    models: ['pipeline', 'vlm'],
    parseMethods: ['auto', 'txt', 'ocr'],
    supportsOcr: true,
    supportsLanguage: true,
    supportsFormula: true,
    supportsTable: true,
    supportsPageRanges: true,
    supportedArtifacts: ['markdown', 'layout', 'model-output', 'content-list', 'images'],
    maxFilesPerSubmission: 10,
    maxFileBytes: 200 * 1024 * 1024,
  }

  submitCount = 0
  markdown = '# Default Mock Markdown\n\nDefault content.\n'
  contentList: ContentListBlock[] = []
  images: MockImageArtifact[] = []
  omitMarkdown = false

  probe(_context: ProviderCallContext): Promise<ProviderProbeResult> {
    return Promise.resolve({ available: true, provider: this.id, authentication: 'not-configured', protocolVersion: 'v2' })
  }

  compatibilityKey(_request: CanonicalParseRequest, _context: ProviderCompatibilityContext): Promise<string> {
    return Promise.resolve('self-hosted-v2:test:reading:v1')
  }

  async submit(
    request: CanonicalParseRequest,
    _sources: readonly PreparedSourceFile[],
    context: ProviderCallContext,
  ): Promise<ProviderSubmission> {
    this.submitCount++
    const ref: ProviderJobRef = {
      provider: this.id,
      taskId: `reading-task-${this.submitCount}`,
      files: request.files.map(file => ({ dataId: `data_${file.fileId}`, fileId: file.fileId, name: file.name })),
    }
    await context.onAccepted?.(ref)
    return {
      ref,
      state: 'processing',
      files: request.files.map(file => ({ fileId: file.fileId, state: 'processing' })),
    }
  }

  inspect(ref: ProviderJobRef, _context: ProviderCallContext): Promise<ProviderJobSnapshot> {
    return Promise.resolve({
      state: 'completed',
      files: ref.files.map(file => ({ fileId: file.fileId, state: 'completed' as const })),
    })
  }

  async collect(
    ref: ProviderJobRef,
    _request: CanonicalParseRequest,
    sink: ArtifactSink,
    _context: ProviderCallContext,
  ): Promise<ProviderCollection> {
    const files: Array<ProviderCollection['files'][number]> = []
    for (const file of ref.files) {
      const artifacts: any[] = []
      if (!this.omitMarkdown) {
        const md = await sink.writeArtifact(file.fileId, 'markdown', this.markdown, { mediaType: 'text/markdown' })
        artifacts.push(md)
      }
      if (this.contentList.length > 0) {
        const clJson = JSON.stringify(this.contentList)
        const clArt = await sink.writeArtifact(file.fileId, 'content-list', clJson, { mediaType: 'application/json' })
        artifacts.push(clArt)
      }
      for (const img of this.images) {
        const imgArt = await sink.writeArtifact(file.fileId, 'images', img.data, {
          relativeName: img.relativeName,
          mediaType: img.mediaType,
        })
        artifacts.push(imgArt)
      }
      for (const kind of _request.requiredArtifacts) {
        if (!artifacts.some(a => a.kind === kind)) {
          if (kind === 'layout') {
            const art = await sink.writeArtifact(file.fileId, kind, '{"pdf_info":[]}', { mediaType: 'application/json' })
            artifacts.push(art)
          } else if (kind === 'model-output') {
            const art = await sink.writeArtifact(file.fileId, kind, '{}', { mediaType: 'application/json' })
            artifacts.push(art)
          } else if (kind === 'content-list' && this.contentList.length === 0) {
            const art = await sink.writeArtifact(file.fileId, kind, '[]', { mediaType: 'application/json' })
            artifacts.push(art)
          } else if (kind === 'images' && this.images.length === 0) {
            const art = await sink.writeArtifact(file.fileId, kind, PNG_1X1, { mediaType: 'image/png' })
            artifacts.push(art)
          }
        }
      }
      files.push({ fileId: file.fileId, name: file.name, artifacts })
    }
    return { files }
  }
}

class MockProviderRegistry extends ProviderRegistry {
  constructor(getConfig: () => MinerUConfig, private readonly mock: MinerUProvider) {
    super(getConfig)
  }
  override create(): MinerUProvider {
    return this.mock
  }
}

interface HarnessOptions {
  maxInlineChars?: number
  maxInlineImages?: number
}

interface SavedAttachment {
  attachmentId: string
  mediaType: string
  name?: string
  bytes: number
}

interface TestHarness {
  readonly root: string
  readonly file: string
  readonly fileSha256: string
  readonly config: MinerUConfig
  readonly provider: ModelReadingMockProvider
  readonly results: ResultRepository
  readonly operations: SharedOperationRegistry
  readonly service: MinerUService
  readonly readPdfTool: DefineToolOptions
  readonly savedAttachments: SavedAttachment[]
  readonly executeRead: (
    args: Record<string, unknown>,
    execOptions?: { hasVision?: boolean; signal?: AbortSignal },
  ) => Promise<ResultView>
}

const activeHarnesses: TestHarness[] = []

async function makeWritable(path: string): Promise<void> {
  await chmod(path, 0o755).catch(() => undefined)
  let entries
  try { entries = await readdir(path, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) await makeWritable(child)
    else await chmod(child, 0o644).catch(() => undefined)
  }
}

async function createHarness(options: HarnessOptions = {}): Promise<TestHarness> {
  const root = await mkdtemp(join(tmpdir(), 'mineru-model-reading-'))
  const file = join(root, 'document.pdf')
  const pdfBytes = Buffer.from('%PDF-1.4 model reading integration test\n%EOF')
  await writeFile(file, pdfBytes)
  const fileSha256 = createHash('sha256').update(pdfBytes).digest('hex')

  const base = defaultMinerUConfig()
  const config: MinerUConfig = {
    ...base,
    storage: { ...base.storage, storageRoot: join(root, 'store') },
    polling: { ...base.polling, pollIntervalMs: 2, pollTimeoutMs: 100, operationTimeoutMs: 5000 },
    output: {
      maxInlineChars: options.maxInlineChars ?? 200_000,
      maxInlineImages: options.maxInlineImages ?? 6,
    },
  }

  const paths = new StoragePaths(config.storage.storageRoot)
  const results = new ResultRepository(paths, { maxArtifactBytes: config.limits.maxZipEntryBytes })
  const operations = new SharedOperationRegistry()
  const provider = new ModelReadingMockProvider()
  const providers = new MockProviderRegistry(() => config, provider)

  const service = new MinerUService({
    getConfig: () => config,
    providers,
    results,
    operations,
    diagnostics: () => {},
    resolveCredential: () => Promise.resolve(undefined),
  })

  const savedAttachments: SavedAttachment[] = []
  const registeredTools: DefineToolOptions[] = []

  const resolveModelInfo = vi.fn(async (_provider: string, model: string) => ({
    inputModalities: model === 'text-only' ? ['text'] : ['text', 'image'],
  }))
  const saveImage = vi.fn(async (params: { data: Buffer; mediaType: string; name?: string }) => {
    const att = {
      attachmentId: `att_${savedAttachments.length + 1}`,
      mediaType: params.mediaType,
      name: params.name,
      bytes: params.data.byteLength,
    }
    savedAttachments.push(att)
    return att
  })

  const ctx = {
    tools: {
      register: (def: DefineToolOptions) => {
        registeredTools.push(def)
        return () => {}
      },
      schemas: () => [],
    },
    get: (name: string) => {
      if (name === 'llm') return { resolveModelInfo }
      if (name === 'attachments') return { saveImage }
      return undefined
    },
    effect: () => {},
    on: () => {},
    inject: () => {},
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  } as unknown as Context

  registerTools(ctx, () => service, undefined, () => config.output)
  const readPdfTool = registeredTools.find(t => t.name === 'read_pdf')!

  const executeRead = async (
    args: Record<string, unknown>,
    execOptions: { hasVision?: boolean; signal?: AbortSignal } = {},
  ): Promise<ResultView> => {
    const signal = execOptions.signal ?? new AbortController().signal
    const exec: ToolRunContext = {
      callId: 'call_test',
      name: 'read_pdf',
      arguments: args,
      signal,
      agent: {
        id: 'agent_reading',
        options: {
          provider: 'mock-llm',
          model: execOptions.hasVision === false ? 'text-only' : 'vision-model',
        },
        session: {
          id: 'session_reading',
          header: { id: 'session_reading', cwd: root },
        },
      },
    }
    return (await readPdfTool.execute(args, exec)) as ResultView
  }

  const h: TestHarness = {
    root,
    file,
    fileSha256,
    config,
    provider,
    results,
    operations,
    service,
    readPdfTool,
    savedAttachments,
    executeRead,
  }
  activeHarnesses.push(h)
  return h
}

afterEach(async () => {
  const completed = activeHarnesses.splice(0)
  await Promise.all(
    completed.map(async h => {
      await h.operations.shutdown()
      await makeWritable(h.root)
      await rm(h.root, { recursive: true, force: true })
    }),
  )
})

// 1x1 transparent PNG buffer fixture
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

describe('read_pdf model reading contract', () => {
  it('returns compact ResultView with files[{file_id, name, artifacts: []}], source_sha256, and omits default paths/repeated toc', async () => {
    const h = await createHarness()
    h.provider.contentList = [
      { type: 'text', page_idx: 0, text: 'First paragraph of introduction.' },
      { type: 'text', page_idx: 1, text: 'Second paragraph on page 2.' },
    ]

    const result = await h.executeRead({ file_path: h.file })

    expect(result.state).toBe('completed')
    expect(result.files).toHaveLength(1)
    expect(result.files[0]!.file_id).toMatch(/^mf_/)
    expect(result.files[0]!.name).toBe('document.pdf')
    expect(result.files[0]!.artifacts).toEqual([])
    expect(result.source_sha256).toBe(h.fileSha256)

    // Omitted in compact default view
    expect(result.manifest_path).toBeUndefined()
    expect(result.markdown_path).toBeUndefined()
    expect(result.toc).toBeUndefined()
    if (result.summary) {
      expect((result.summary as Record<string, unknown>).toc).toBeUndefined()
      expect(result.summary.page_count).toBe(2)
    }

    // Schema validation passes with 0 violations
    const violations = validateJsonSchemaValue(h.readPdfTool.output.schema, result, 'value')
    expect(violations).toEqual([])
  })

  it('caps body chunks to <= 8000 characters even when maxInlineChars is 200,000', async () => {
    const h = await createHarness({ maxInlineChars: 200_000 })
    // Build content-list blocks totaling > 16,000 characters
    const blocks: ContentListBlock[] = []
    for (let i = 0; i < 10; i++) {
      blocks.push({
        type: 'text',
        page_idx: Math.floor(i / 2),
        text: `Paragraph ${i + 1}: ` + 'word '.repeat(350),
      })
    }
    h.provider.contentList = blocks

    const result = await h.executeRead({ file_path: h.file })

    expect(result.content_status).toBe('partial')
    expect(result.cursor).toBeTypeOf('string')
    expect(result.cursor!.length).toBeGreaterThan(0)
    expect(result.markdown_content!.length).toBeLessThanOrEqual(MAX_MODEL_MARKDOWN_CHARS)
    expect(result.markdown_content!.length).toBeLessThanOrEqual(8000)
  })

  it('does not produce string-suppression marker under host node:util.inspect', async () => {
    const h = await createHarness({ maxInlineChars: 200_000 })
    const blocks: ContentListBlock[] = []
    for (let i = 0; i < 8; i++) {
      blocks.push({
        type: 'text',
        page_idx: 0,
        text: `Block ${i + 1}: ` + 'content '.repeat(200),
      })
    }
    h.provider.contentList = blocks

    const result = await h.executeRead({ file_path: h.file })

    const inspected = util.inspect(result)
    expect(inspected).not.toMatch(/\.\.\. \d+ more characters/)
    expect(inspected).not.toContain('more character')
  })

  it('provides null cursor on complete delivery and valid V2 cursor on partial delivery', async () => {
    const h = await createHarness()
    h.provider.contentList = [
      { type: 'text', page_idx: 0, text: 'Short document fitting in one single chunk.' },
    ]

    // Complete reading
    const completeResult = await h.executeRead({ file_path: h.file })
    expect(completeResult.content_status).toBe('complete')
    expect(completeResult.cursor).toBeNull()

    // Partial reading (using fresh harness to avoid cache hit)
    const hPartial = await createHarness()
    const longBlocks: ContentListBlock[] = []
    for (let i = 0; i < 8; i++) {
      longBlocks.push({ type: 'text', page_idx: 0, text: `Part ${i}: ` + 'data '.repeat(300) })
    }
    hPartial.provider.contentList = longBlocks

    const partialResult = await hPartial.executeRead({ file_path: hPartial.file })
    expect(partialResult.content_status).toBe('partial')
    expect(partialResult.cursor).toBeTypeOf('string')

    const decoded = decodeReadCursor(partialResult.cursor!)
    expect(decoded.v).toBe(READ_CURSOR_VERSION)
    expect(decoded.v).toBe(2)
    expect(decoded.rid).toBe(partialResult.result_id)
    expect(decoded.off).toBeGreaterThan(0)
  })

  it('rejects legacy V1 cursor tokens', async () => {
    const h = await createHarness()
    h.provider.contentList = [{ type: 'text', page_idx: 0, text: 'Content text.' }]
    const first = await h.executeRead({ file_path: h.file })

    // Valid base64url JSON with version 1
    const v1Payload = {
      v: 1,
      rid: first.result_id,
      pages: '',
      focus: ['all'],
      off: 10,
    }
    const v1Token = Buffer.from(JSON.stringify(v1Payload), 'utf8').toString('base64url')

    expect(() => decodeReadCursor(v1Token)).toThrow(/cursor is expired; re-read without a cursor/)

    await expect(h.executeRead({ file_path: h.file, cursor: v1Token })).rejects.toMatchObject({
      failure: { code: 'INVALID_REQUEST' },
    })
  })

  it('concatenates multi-chunk projected text without loss or duplication, preserving emojis and math', async () => {
    const h = await createHarness()
    const blocks: ContentListBlock[] = [
      {
        type: 'text',
        page_idx: 0,
        text: 'Section 1: 深度学习与自然语言处理 🚀\n' + '自然语言处理技术蓬勃发展。'.repeat(250),
      },
      {
        type: 'equation',
        page_idx: 0,
        caption: 'Eq. (1): Gaussian integral',
        text: '\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}',
      },
      {
        type: 'text',
        page_idx: 1,
        text: 'Section 2: 评估指标与性能分析 📊\n' + '准确率与召回率显著提升。'.repeat(250),
      },
      {
        type: 'text',
        page_idx: 1,
        text: 'Section 3: 总结与展望 🌟 🧪 🤖\n' + '多模态大模型未来可期。'.repeat(200),
      },
    ]
    h.provider.contentList = blocks

    const chunks: string[] = []
    let current = await h.executeRead({ file_path: h.file })
    chunks.push(current.markdown_content!)

    while (current.content_status === 'partial' && current.cursor) {
      current = await h.executeRead({ file_path: h.file, cursor: current.cursor })
      chunks.push(current.markdown_content!)
    }

    expect(current.content_status).toBe('complete')
    expect(current.cursor).toBeNull()
    expect(chunks.length).toBeGreaterThan(1)

    // Verify each chunk boundary is clean and surrogate-safe
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_MODEL_MARKDOWN_CHARS)
      expect(chunk).not.toMatch(/^[�-�]/)
      expect(chunk).not.toMatch(/[�-�]$/)
      expect(Buffer.from(chunk, 'utf8').toString('utf8')).toBe(chunk)
    }

    const fullText = chunks.join('')
    expect(fullText).toContain('Section 1: 深度学习与自然语言处理 🚀')
    expect(fullText).toContain('\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}')
    expect(fullText).toContain('Section 2: 评估指标与性能分析 📊')
    expect(fullText).toContain('Section 3: 总结与展望 🌟 🧪 🤖')
  })

  it('assigns stable block IDs \${result_id}:bN in 1-based original order and formats body markers', async () => {
    const h = await createHarness()
    h.provider.contentList = [
      { type: 'text', page_idx: 0, text: 'Introduction block.' },
      { type: 'image', page_idx: 0, caption: 'Figure 1: Pipeline diagram', img_path: 'images/fig1.png' },
      { type: 'table', page_idx: 1, caption: 'Table 1: Benchmark scores', table_body: '<table></table>' },
      { type: 'text', page_idx: 1, text: 'Conclusion block.' },
    ]

    const result = await h.executeRead({ file_path: h.file })
    const rid = result.result_id

    expect(result.markdown_content).toContain(`[${rid}:b1 · Page 1]`)
    expect(result.markdown_content).toContain(`[${rid}:b2 · Page 1 · Figure 1]`)
    expect(result.markdown_content).toContain(`[${rid}:b3 · Page 2 · Table 1]`)
    expect(result.markdown_content).toContain(`[${rid}:b4 · Page 2]`)

    // Page filtering retains original document indices (b3 and b4, NOT renumbered to b1 and b2)
    const page2Result = await h.executeRead({ file_path: h.file, pages: 2 })
    expect(page2Result.markdown_content).not.toContain(`[${rid}:b1`)
    expect(page2Result.markdown_content).not.toContain(`[${rid}:b2`)
    expect(page2Result.markdown_content).toContain(`[${rid}:b3 · Page 2 · Table 1]`)
    expect(page2Result.markdown_content).toContain(`[${rid}:b4 · Page 2]`)
  })

  it('uses document_label for figure markdown instead of selection ordinal', async () => {
    const h = await createHarness()
    h.provider.contentList = [
      { type: 'image', page_idx: 0, caption: 'Figure 5: Model architecture overview', img_path: 'images/f5.png' },
      { type: 'image', page_idx: 0, caption: 'Ablation plot without standard label', img_path: 'images/f6.png' },
    ]

    const result = await h.executeRead({ file_path: h.file })

    // Figure 5 uses author document_label, NOT ordinal "Figure 1"
    expect(result.markdown_content).toContain('> Figure 5 (Page 1)')
    expect(result.markdown_content).not.toContain('> Figure 1 (Page 1)')

    // Unlabeled figure uses generic Image, NOT ordinal "Figure 2"
    expect(result.markdown_content).toContain('> Image (Page 1)')
    expect(result.markdown_content).not.toContain('> Figure 2')

    // ordered_images candidates reflect document_label and stable block_id
    expect(result.ordered_images).toHaveLength(2)
    expect(result.ordered_images![0]!.document_label).toBe('Figure 5')
    expect(result.ordered_images![0]!.block_id).toBe(`${result.result_id}:b1`)
    expect(result.ordered_images![1]!.document_label).toBeUndefined()
    expect(result.ordered_images![1]!.block_id).toBe(`${result.result_id}:b2`)
  })

  it('searches document blocks with literal query <= 256, returning block IDs and contextual snippets', async () => {
    const h = await createHarness()
    h.provider.contentList = [
      {
        type: 'text',
        page_idx: 0,
        text: 'The self-attention mechanism enables capturing long-range dependencies efficiently.',
      },
      {
        type: 'text',
        page_idx: 0,
        text: 'Convolutional neural networks excel at spatial hierarchy feature learning.',
      },
      {
        type: 'text',
        page_idx: 1,
        text: 'Attention weights are computed through query and key matrix multiplications.',
      },
    ]

    const searchResult = await h.executeRead({ file_path: h.file, query: 'attention' })
    const rid = searchResult.result_id

    expect(searchResult.markdown_content).toContain(`[${rid}:b1 · Page 1]`)
    expect(searchResult.markdown_content).toContain('self-attention mechanism')
    expect(searchResult.markdown_content).toContain(`[${rid}:b3 · Page 2]`)
    expect(searchResult.markdown_content).toContain('Attention weights are computed')
    expect(searchResult.markdown_content).not.toContain('Convolutional neural networks')

    // Case-insensitive matching
    const upperResult = await h.executeRead({ file_path: h.file, query: 'SELF-ATTENTION' })
    expect(upperResult.markdown_content).toContain(`[${rid}:b1 · Page 1]`)

    // Query validation: empty and length > 256
    await expect(h.executeRead({ file_path: h.file, query: '' })).rejects.toMatchObject({
      failure: { code: 'INVALID_REQUEST' },
    })
    await expect(h.executeRead({ file_path: h.file, query: '   ' })).rejects.toMatchObject({
      failure: { code: 'INVALID_REQUEST' },
    })
    await expect(h.executeRead({ file_path: h.file, query: 'a'.repeat(257) })).rejects.toMatchObject({
      failure: { code: 'INVALID_REQUEST' },
    })
  })

  it('handles search misses cleanly with an explicit model-facing message', async () => {
    const h = await createHarness()
    h.provider.contentList = [
      { type: 'text', page_idx: 0, text: 'Standard machine learning concepts and equations.' },
    ]

    const result = await h.executeRead({
      file_path: h.file,
      query: 'quantum superposition teleportation non-existent',
    })

    expect(result.content_status).toBe('complete')
    expect(result.cursor).toBeNull()
    expect(result.markdown_content).toBe('No literal matches in the selected parsed blocks.')
  })

  it('reads full block using block_id and validates output', async () => {
    const h = await createHarness()
    h.provider.contentList = [
      { type: 'text', page_idx: 0, text: 'Block one first paragraph.' },
      { type: 'text', page_idx: 1, text: 'Block two detailed explanation with specific formulas.' },
      { type: 'text', page_idx: 1, text: 'Block three final summary.' },
    ]

    const first = await h.executeRead({ file_path: h.file })
    const targetBlockId = `${first.result_id}:b2`

    const blockResult = await h.executeRead({ file_path: h.file, block_id: targetBlockId })

    expect(blockResult.markdown_content).toContain(`[${targetBlockId} · Page 2]`)
    expect(blockResult.markdown_content).toContain('Block two detailed explanation')
    expect(blockResult.markdown_content).not.toContain('Block one first paragraph.')
    expect(blockResult.markdown_content).not.toContain('Block three final summary.')

    const violations = validateJsonSchemaValue(h.readPdfTool.output.schema, blockResult, 'value')
    expect(violations).toEqual([])
  })

  it('rejects arbitrary, malformed, and mismatched block_ids', async () => {
    const h = await createHarness()
    h.provider.contentList = [
      { type: 'text', page_idx: 0, text: 'Page 1 block.' },
      { type: 'text', page_idx: 1, text: 'Page 2 block.' },
    ]
    const first = await h.executeRead({ file_path: h.file })
    const rid = first.result_id

    // Malformed formats rejected by tool schema / input parser
    for (const badId of ['invalid_id', 'b1', 'mr_123', 'mr_123:b0', 'mr_123:b-1']) {
      await expect(h.executeRead({ file_path: h.file, block_id: badId })).rejects.toMatchObject({
        failure: { code: 'INVALID_REQUEST' },
      })
    }

    // Wrong result ID
    await expect(
      h.executeRead({ file_path: h.file, block_id: 'mr_foreignresult12345:b1' }),
    ).rejects.toMatchObject({
      failure: { code: 'INVALID_REQUEST', message: expect.stringContaining('does not belong to the current parsed result') },
    })

    // Out-of-range block index
    await expect(
      h.executeRead({ file_path: h.file, block_id: `${rid}:b9999` }),
    ).rejects.toMatchObject({
      failure: { code: 'INVALID_REQUEST', message: expect.stringContaining('does not belong to the current parsed result') },
    })

    // Block outside requested page selection (b1 is on page 1, requesting page 2)
    await expect(
      h.executeRead({ file_path: h.file, block_id: `${rid}:b1`, pages: 2 }),
    ).rejects.toMatchObject({
      failure: { code: 'INVALID_REQUEST', message: expect.stringContaining('outside the requested pages/focus') },
    })

    // Cannot combine block_id and query
    await expect(
      h.executeRead({ file_path: h.file, block_id: `${rid}:b1`, query: 'test' }),
    ).rejects.toMatchObject({
      failure: { code: 'INVALID_REQUEST', message: expect.stringContaining('cannot be combined') },
    })

    // Cannot combine block_id or query with toc or artifacts focus
    for (const forbiddenFocus of ['toc', 'artifacts']) {
      await expect(
        h.executeRead({ file_path: h.file, block_id: `${rid}:b1`, focus: forbiddenFocus }),
      ).rejects.toMatchObject({
        failure: { code: 'INVALID_REQUEST' },
      })
      await expect(
        h.executeRead({ file_path: h.file, query: 'find', focus: forbiddenFocus }),
      ).rejects.toMatchObject({
        failure: { code: 'INVALID_REQUEST' },
      })
    }
  })

  it('restores selectors from continuation cursor and rejects overriding selectors', async () => {
    const h = await createHarness({ maxInlineChars: 200_000 })
    // Long query search match that spans multiple chunks (25 matching blocks)
    const blocks: ContentListBlock[] = []
    for (let i = 0; i < 25; i++) {
      blocks.push({
        type: 'text',
        page_idx: 0,
        text: `Block ${i + 1} query hit attention mechanism description. ` + 'detail '.repeat(70),
      })
    }
    h.provider.contentList = blocks

    const initial = await h.executeRead({ file_path: h.file, query: 'attention' })
    expect(initial.content_status).toBe('partial')
    expect(initial.cursor).toBeTypeOf('string')

    const decoded = decodeReadCursor(initial.cursor!)
    expect(decoded.query).toBe('attention')

    // Continuation with only cursor restores query selection
    const next = await h.executeRead({ file_path: h.file, cursor: initial.cursor })
    expect(next.markdown_content).toContain('attention')

    // Supplying selection parameters along with cursor is strictly rejected
    for (const conflict of [
      { pages: 1 },
      { focus: 'text' },
      { block_id: `${initial.result_id}:b1` },
      { query: 'attention' },
    ]) {
      await expect(
        h.executeRead({ file_path: h.file, cursor: initial.cursor, ...conflict }),
      ).rejects.toMatchObject({
        failure: { code: 'INVALID_REQUEST', message: expect.stringContaining('must be omitted when cursor is provided') },
      })
    }
  })

  it('normalizes and renders nested lines.spans fixtures with Unicode and math', async () => {
    const h = await createHarness()
    h.provider.contentList = [
      {
        type: 'text',
        page_idx: 0,
        lines: [
          {
            spans: [
              { type: 'text', content: '已知连续函数 ' },
              { type: 'inline_equation', content: 'f(x) \\in C^1([0, 1])' },
              { type: 'text', content: ' 满足 ' },
              { type: 'inline_equation', content: 'f(0) = 0' },
              { type: 'text', content: '。' },
            ],
          },
          {
            spans: [
              { type: 'text', content: '积分界限：' },
              { type: 'inline_equation', content: '\\alpha \\le x \\le \\beta' },
            ],
          },
        ],
      },
      {
        type: 'equation',
        page_idx: 0,
        caption: '(3) 积分表达式',
        lines: [
          {
            spans: [
              { type: 'equation', content: '\\int_0^1 (f\'(x))^2 dx \\ge \\pi^2 \\int_0^1 f(x)^2 dx' },
            ],
          },
        ],
      },
      {
        type: 'code',
        page_idx: 0,
        language: 'typescript',
        lines: [
          {
            spans: [
              { type: 'code', content: 'export const calculateNorm = (v: number[]): number => Math.hypot(...v);' },
            ],
          },
        ],
      },
    ]

    const result = await h.executeRead({ file_path: h.file })

    // Inline math properly delimited with single dollar
    expect(result.markdown_content).toContain('已知连续函数 $f(x) \\in C^1([0, 1])$ 满足 $f(0) = 0$。')
    expect(result.markdown_content).toContain('积分界限：$\\alpha \\le x \\le \\beta$')

    // Display equation delimited with double dollars
    expect(result.markdown_content).toContain('$$\\int_0^1 (f\'(x))^2 dx \\ge \\pi^2 \\int_0^1 f(x)^2 dx$$')

    // Code block with language tag
    expect(result.markdown_content).toContain('```typescript\nexport const calculateNorm = (v: number[]): number => Math.hypot(...v);\n```')

    // No corrupt placeholder tokens
    expect(result.markdown_content).not.toContain('[object Object]')
  })

  it('enforces compact JSON and prose tool budgets within configured limits', async () => {
    const h = await createHarness({ maxInlineChars: 4000 })
    h.provider.contentList = [
      { type: 'text', page_idx: 0, text: 'Budget test paragraph. '.repeat(100) },
    ]

    const result = await h.executeRead({ file_path: h.file })

    expect(fitsReadBudget(result)).toBe(true)
    const json = JSON.stringify(result)
    const prose = formatResultProse(result)

    expect(json.length).toBeLessThanOrEqual(result.output_limit_chars)
    expect(prose.length).toBeLessThanOrEqual(result.output_limit_chars)
    expect(Buffer.byteLength(json, 'utf8')).toBeLessThanOrEqual(MAX_MODEL_RESPONSE_BYTES)
    expect(Buffer.byteLength(prose, 'utf8')).toBeLessThanOrEqual(MAX_MODEL_RESPONSE_BYTES)
  })

  it('strictly validates native tool output schema across all result variants', async () => {
    const h = await createHarness()
    h.provider.contentList = [
      { type: 'text', page_idx: 0, text: 'Schema validation content.' },
      { type: 'image', page_idx: 0, caption: 'Figure 1: Diagram', img_path: 'images/img1.png' },
    ]
    h.provider.images = [
      { relativeName: 'images/img1.png', data: PNG_1X1, mediaType: 'image/png' },
    ]

    // 1. Text read with inlined images
    const withImages = await h.executeRead({ file_path: h.file, inline_images: true })
    expect(validateJsonSchemaValue(h.readPdfTool.output.schema, withImages, 'value')).toEqual([])

    // 2. Query search result
    const searchRes = await h.executeRead({ file_path: h.file, query: 'Schema' })
    expect(validateJsonSchemaValue(h.readPdfTool.output.schema, searchRes, 'value')).toEqual([])

    // 3. Single block result
    const blockRes = await h.executeRead({ file_path: h.file, block_id: `${withImages.result_id}:b1` })
    expect(validateJsonSchemaValue(h.readPdfTool.output.schema, blockRes, 'value')).toEqual([])

    // 4. Artifacts-only focus result
    const artRes = await h.executeRead({ file_path: h.file, focus: 'artifacts' })
    expect(artRes.content_status).toBe('not_requested')
    expect(validateJsonSchemaValue(h.readPdfTool.output.schema, artRes, 'value')).toEqual([])
  })

  it('explicitly reports omitted images in large batches and does not repeat attachments across continuation chunks', async () => {
    const h = await createHarness({ maxInlineImages: 2 })

    // Build 6 images
    const imagesList: MockImageArtifact[] = []
    const contentBlocks: ContentListBlock[] = []
    for (let i = 1; i <= 6; i++) {
      imagesList.push({ relativeName: `images/fig${i}.png`, data: PNG_1X1, mediaType: 'image/png' })
      contentBlocks.push({
        type: 'image',
        page_idx: 0,
        caption: `Figure ${i}: Diagram ${i}`,
        img_path: `images/fig${i}.png`,
      })
    }
    h.provider.images = imagesList
    h.provider.contentList = contentBlocks

    const result = await h.executeRead({ file_path: h.file, inline_images: true })

    // Listed 6, but inline budget capped attached to 2
    expect(result.visuals).toEqual({
      listed: 6,
      attached: 2,
      omitted: 4,
      scope: 'chunk',
    })
    expect(result.warnings).toBeDefined()
    expect(result.warnings!.some(w => w.includes('[VISUALS_NOT_ATTACHED]'))).toBe(true)

    // Now test image locator localization across chunks:
    // Image 1 is in Chunk 1 text, Image 2 is in Chunk 2 text
    const multiChunkHarness = await createHarness({ maxInlineChars: 200_000, maxInlineImages: 5 })
    multiChunkHarness.provider.images = [
      { relativeName: 'images/first.png', data: PNG_1X1, mediaType: 'image/png' },
      { relativeName: 'images/second.png', data: PNG_1X1, mediaType: 'image/png' },
    ]
    multiChunkHarness.provider.contentList = [
      { type: 'image', page_idx: 0, caption: 'Figure 1: First figure', img_path: 'images/first.png' },
      { type: 'text', page_idx: 0, text: 'Long filler paragraph. '.repeat(450) },
      { type: 'image', page_idx: 1, caption: 'Figure 2: Second figure', img_path: 'images/second.png' },
    ]

    const chunk1 = await multiChunkHarness.executeRead({ file_path: multiChunkHarness.file, inline_images: true })
    expect(chunk1.content_status).toBe('partial')
    expect(chunk1.ordered_images).toBeDefined()
    // Chunk 1 ordered images contains only Figure 1 (Figure 2 is not in chunk 1 text)
    expect(chunk1.ordered_images!.some(img => img.name.includes('first'))).toBe(true)
    expect(chunk1.ordered_images!.some(img => img.name.includes('second'))).toBe(false)

    // Chunk 2 continuation
    const chunk2 = await multiChunkHarness.executeRead({
      file_path: multiChunkHarness.file,
      cursor: chunk1.cursor,
      inline_images: true,
    })
    expect(chunk2.ordered_images).toBeDefined()
    // Chunk 2 ordered images contains Figure 2, but does NOT repeat Figure 1
    expect(chunk2.ordered_images!.some(img => img.name.includes('second'))).toBe(true)
    expect(chunk2.ordered_images!.some(img => img.name.includes('first'))).toBe(false)
  })
})

describe('literal search Unicode and service boundary regressions', () => {
  it('locates an exact literal after case-fold-expanding Unicode without shifting snippet offsets', async () => {
    const h = await createHarness()
    h.provider.contentList = [{ type: 'text', page_idx: 0, text: 'İ'.repeat(100) + 'Needle[a+b]' + 'tail'.repeat(200) }]
    const result = await h.executeRead({ file_path: h.file, query: 'needle[a+b]' })
    expect(result.markdown_content).toContain('Needle[a+b]')
    expect(result.markdown_content).not.toContain('No literal matches')
  })
  it('rejects invalid selectors at the service boundary before a producer starts', async () => {
    const h = await createHarness()
    const session = { header: { id: 'direct-test', cwd: h.root } }
    for (const args of [{ query: 'x'.repeat(257) }, { query: '' }, { block_id: 'not-an-id' }, { query: 'x', focus: 'toc' as const }]) {
      await expect(h.service.parseDocument(session, { file_path: h.file, ...args }, new AbortController().signal, null)).rejects.toMatchObject({ failure: { code: 'INVALID_REQUEST' } })
    }
    expect(h.provider.submitCount).toBe(0)
  })
})

describe('review regression suite', () => {
  it('(1) literal unclosed [mr_ in long source cannot stall progress, concat exact and mid-block chunks continuation_block correct', async () => {
    const h = await createHarness({ maxInlineChars: 200_000 })
    // Block 1 is very long (> 10,000 chars) and contains literal unclosed [mr_ snippets in its body
    const literalUnclosed = 'Sample text with literal [mr_fake_identifier and more [mr_unclosed text. '
    const longBlockText = literalUnclosed + 'Word '.repeat(2000)
    h.provider.contentList = [
      { type: 'text', page_idx: 0, text: longBlockText },
      { type: 'text', page_idx: 1, text: 'Second block following the long block.' },
    ]

    const chunk1 = await h.executeRead({ file_path: h.file })
    expect(chunk1.content_status).toBe('partial')
    expect(chunk1.cursor).toBeTypeOf('string')
    expect(chunk1.markdown_content!.length).toBeLessThanOrEqual(MAX_MODEL_MARKDOWN_CHARS)
    expect(chunk1.continuation_block).toBeUndefined()

    // Chunk 2 continues mid-block of block 1
    const chunk2 = await h.executeRead({ file_path: h.file, cursor: chunk1.cursor })
    expect(chunk2.continuation_block).toBeDefined()
    expect(chunk2.continuation_block!.block_id).toBe(`${chunk1.result_id}:b1`)
    expect(chunk2.continuation_block!.page).toBe(1)

    // Complete reading all remaining chunks
    const chunks = [chunk1.markdown_content!, chunk2.markdown_content!]
    let curr = chunk2
    while (curr.content_status === 'partial' && curr.cursor) {
      curr = await h.executeRead({ file_path: h.file, cursor: curr.cursor })
      chunks.push(curr.markdown_content!)
    }
    expect(curr.content_status).toBe('complete')

    const fullProjected = chunks.join('')
    expect(fullProjected).toContain(literalUnclosed)
    expect(fullProjected).toContain('Second block following the long block.')
  })

  it('(2) minimum output 1024 makes progress for content-list and correct cursor', async () => {
    const h = await createHarness({ maxInlineChars: 1024 })
    h.provider.contentList = [
      { type: 'text', page_idx: 0, text: 'Small budget block one text. ' + 'content '.repeat(100) },
      { type: 'text', page_idx: 0, text: 'Small budget block two text. ' + 'content '.repeat(100) },
    ]

    const chunk1 = await h.executeRead({ file_path: h.file })
    expect(chunk1.content_status).toBe('partial')
    expect(chunk1.markdown_content!.length).toBeLessThanOrEqual(1024)
    expect(chunk1.cursor).toBeTypeOf('string')
    expect(fitsReadBudget(chunk1)).toBe(true)

    // Verify progress continues with cursor
    const chunk2 = await h.executeRead({ file_path: h.file, cursor: chunk1.cursor })
    expect(chunk2.markdown_content!.length).toBeGreaterThan(0)
    expect(chunk2.markdown_content!.length).toBeLessThanOrEqual(1024)
  })

  it('(3) partial focus [all,text] and [all,artifacts] returned cursor works', async () => {
    const h = await createHarness({ maxInlineChars: 200_000 })
    const longBlocks: ContentListBlock[] = []
    for (let i = 0; i < 8; i++) {
      longBlocks.push({ type: 'text', page_idx: 0, text: `Section ${i}: ` + 'information '.repeat(250) })
    }
    h.provider.contentList = longBlocks

    // 1. Focus [all, text]
    const resText = await h.executeRead({ file_path: h.file, focus: ['all', 'text'] })
    expect(resText.content_status).toBe('partial')
    expect(resText.cursor).toBeTypeOf('string')
    const decodedText = decodeReadCursor(resText.cursor!)
    expect(decodedText.focus).toEqual(['all', 'text'])

    const nextText = await h.executeRead({ file_path: h.file, cursor: resText.cursor })
    expect(nextText.markdown_content!.length).toBeGreaterThan(0)

    // 2. Focus [all, artifacts]
    const resArt = await h.executeRead({ file_path: h.file, focus: ['all', 'artifacts'] })
    expect(resArt.content_status).toBe('partial')
    expect(resArt.cursor).toBeTypeOf('string')
    const decodedArt = decodeReadCursor(resArt.cursor!)
    expect(decodedArt.focus).toEqual(['all', 'artifacts'])

    const nextArt = await h.executeRead({ file_path: h.file, cursor: resArt.cursor })
    expect(nextArt.markdown_content!.length).toBeGreaterThan(0)
  })

  it('(4) cache eviction mock results.get undefined on continuation returns CACHE_EVICTED with no new Provider submit', async () => {
    const h = await createHarness({ maxInlineChars: 200_000 })
    h.provider.contentList = [
      { type: 'text', page_idx: 0, text: 'Block for cache eviction test. ' + 'fill '.repeat(2500) },
    ]

    const initial = await h.executeRead({ file_path: h.file })
    expect(initial.content_status).toBe('partial')
    expect(initial.cursor).toBeTypeOf('string')
    const submitCountBefore = h.provider.submitCount

    // Evict cache: mock results.get to return undefined
    vi.spyOn(h.results, 'get').mockResolvedValue(undefined)

    await expect(
      h.executeRead({ file_path: h.file, cursor: initial.cursor }),
    ).rejects.toMatchObject({
      failure: { code: 'CACHE_EVICTED' },
    })

    expect(h.provider.submitCount).toBe(submitCountBefore)
  })

  it('(5) cacheEnabled=false still resumes published result rather than reparse', async () => {
    const h = await createHarness({ maxInlineChars: 200_000 })
    h.provider.contentList = [
      { type: 'text', page_idx: 0, text: 'Block for cacheEnabled false test. ' + 'fill '.repeat(2500) },
    ]

    const initial = await h.executeRead({ file_path: h.file })
    expect(initial.content_status).toBe('partial')
    expect(initial.cursor).toBeTypeOf('string')
    const submitCountBefore = h.provider.submitCount

    // Set cacheEnabled to false
    h.config.storage.cacheEnabled = false

    const next = await h.executeRead({ file_path: h.file, cursor: initial.cursor })
    expect(next.markdown_content!.length).toBeGreaterThan(0)
    expect(h.provider.submitCount).toBe(submitCountBefore)
  })

  it('(6) changed manifest image/artifact sha under same rid/text rejects projection digest before returning content', async () => {
    const h = await createHarness({ maxInlineChars: 200_000 })
    h.provider.contentList = [
      { type: 'text', page_idx: 0, text: 'Long projection test text. ' + 'filler '.repeat(2000) },
    ]

    const initial = await h.executeRead({ file_path: h.file })
    expect(initial.content_status).toBe('partial')
    expect(initial.cursor).toBeTypeOf('string')

    // Corrupt / modify artifact sha in cached manifest
    const originalGet = h.results.get.bind(h.results)
    vi.spyOn(h.results, 'get').mockImplementation(async (...args) => {
      const realManifest = await originalGet(...args)
      if (!realManifest) return undefined
      return {
        ...realManifest,
        files: [
          {
            ...realManifest.files[0]!,
            artifacts: realManifest.files[0]!.artifacts.map(a =>
              a.kind === 'content-list' ? { ...a, sha256: '0'.repeat(64) } : a,
            ),
          },
        ],
      }
    })

    await expect(
      h.executeRead({ file_path: h.file, cursor: initial.cursor }),
    ).rejects.toMatchObject({
      failure: { code: 'INVALID_REQUEST', message: expect.stringContaining('Cursor projection changed or expired') },
    })
  })

  it('(7) mixed located/unlocated text + pages fails SELECTION_UNAVAILABLE, while block_id read works', async () => {
    const h = await createHarness()
    h.provider.contentList = [
      { type: 'text', page_idx: 0, text: 'Located content on page 1.' },
      { type: 'text', page_idx: undefined, text: 'Unlocated content without page_idx.' },
    ]

    // Read with pages fails closed with SELECTION_UNAVAILABLE
    await expect(
      h.executeRead({ file_path: h.file, pages: 1 }),
    ).rejects.toMatchObject({
      failure: { code: 'INVALID_REQUEST', message: expect.stringContaining('[SELECTION_UNAVAILABLE]') },
    })

    // Direct block_id read succeeds
    const first = await h.executeRead({ file_path: h.file })
    const unlocatedBlockId = `${first.result_id}:b2`
    const blockRes = await h.executeRead({ file_path: h.file, block_id: unlocatedBlockId })
    expect(blockRes.markdown_content).toContain('Unlocated content without page_idx.')
  })

  it('(8) beyond last parsed block without authoritative layout returns PAGE_COUNT_LOWER_BOUND not false out-of-range', async () => {
    const h = await createHarness()
    // Provider produces content_list on page 1 only, no layout artifact with page count
    h.provider.contentList = [
      { type: 'text', page_idx: 0, text: 'Single page document.' },
    ]

    const result = await h.executeRead({ file_path: h.file, pages: 5 })
    expect(result.pages).toBe('5')
    expect(result.summary?.page_count).toBe(1)
    expect(result.summary?.page_count_source).toBe('content-list-lower-bound')
    expect(result.warnings).toBeDefined()
    expect(result.warnings!.some(w => w.includes('[PAGE_COUNT_LOWER_BOUND]'))).toBe(true)
  })

  it('(9) decoder rejects empty/duplicate/unsorted focus, query+toc and wrong-result block selectors', () => {
    const toToken = (payload: Record<string, unknown>): string =>
      Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')

    // Empty focus
    expect(() =>
      decodeReadCursor(toToken({ v: 2, rid: 'mr_sample', pages: '', focus: [], off: 0 })),
    ).toThrow(/cursor focus is not canonical/)

    // Duplicate focus
    expect(() =>
      decodeReadCursor(toToken({ v: 2, rid: 'mr_sample', pages: '', focus: ['text', 'text'], off: 0 })),
    ).toThrow(/cursor focus is not canonical/)

    // Unsorted focus
    expect(() =>
      decodeReadCursor(toToken({ v: 2, rid: 'mr_sample', pages: '', focus: ['text', 'all'], off: 0 })),
    ).toThrow(/cursor focus is not canonical/)

    // Query + toc
    expect(() =>
      decodeReadCursor(
        toToken({ v: 2, rid: 'mr_sample', pages: '', focus: ['all', 'toc'], off: 0, query: 'test' }),
      ),
    ).toThrow(/cursor selection cannot use toc or artifacts/)

    // Query + artifacts
    expect(() =>
      decodeReadCursor(
        toToken({ v: 2, rid: 'mr_sample', pages: '', focus: ['all', 'artifacts'], off: 0, query: 'test' }),
      ),
    ).toThrow(/cursor selection cannot use toc or artifacts/)

    // Wrong-result block
    expect(() =>
      decodeReadCursor(
        toToken({ v: 2, rid: 'mr_alpha', pages: '', focus: ['all'], off: 0, block: 'mr_beta:b1' }),
      ),
    ).toThrow(/cursor block belongs to another result/)
  })
})



it('keeps long outline headings complete and attributable across chunks', async () => {
  const h = await createHarness()
  const title = 'Long heading ' + 'x'.repeat(12000)
  h.provider.contentList = [{ type: 'text', text_level: 1, text: title, page_idx: 0 }]
  let view = await h.executeRead({ file_path: h.file, focus: 'toc' })
  const id = view.result_id + ':b1'
  let text = view.markdown_content ?? ''
  expect(view.content_status).toBe('partial')
  for (let rounds = 0; view.cursor && rounds < 10; rounds++) {
    view = await h.executeRead({ file_path: h.file, cursor: view.cursor })
    expect(view.continuation_block?.block_id).toBe(id)
    text += view.markdown_content
  }
  expect(view.cursor).toBeNull()
  expect(text).toBe('# Document Outline\n\n- ' + title + ' (Page 1) [' + id + ']')
})

