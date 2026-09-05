import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-tools', () => ({
  defineTool: <T>(options: T): T => options,
}))

import {
  registerTools,
  renderResult,
  renderParseDocument,
} from '../src/tools.js'
import type { Context } from 'cordis'
import type {
  DefineToolOptions,
  ObjectValueSchemaSpec,
  ToolRunContext,
  ValueSchemaSpec,
} from '@deepseek-ai/dsh-tools'
import type {
  BatchParseDocumentView,
  FailedParseView,
  MinerUService,
  ParseDocumentView,
  ResultView,
} from '../src/service/mineru-service.js'
import { failure, MinerUError } from '../src/domain/errors.js'
import { StorageAccessGate } from '../src/storage/access-gate.js'

interface NativeJobOutcome {
  readonly status: 'completed' | 'killed' | 'failed'
  readonly detail?: string
  readonly output?: string
}

interface NativeJobStartSpec {
  readonly kind: string
  readonly label: string
  readonly owner: NonNullable<ToolRunContext['agent']>
  readonly run: () => {
    readonly cancel: (reason?: string) => void
    readonly done: Promise<NativeJobOutcome>
  }
}

function createMockJobRegistry() {
  let counter = 0
  const specs: NativeJobStartSpec[] = []
  const registry = {
    start: vi.fn((spec: NativeJobStartSpec) => {
      counter++
      specs.push(spec)
      return 'mineru-' + counter
    }),
  }
  return { registry, specs }
}

function createMockContext(jobsRegistry?: unknown) {
  const registeredTools: DefineToolOptions[] = []
  const ctx = {
    tools: {
      register: vi.fn((def: DefineToolOptions) => {
        registeredTools.push(def)
        return vi.fn()
      }),
      schemas: vi.fn(() => []),
    },
    get: vi.fn((name: string) => {
      if (name === 'jobs') return jobsRegistry
      return undefined
    }),
    effect: vi.fn(),
    on: vi.fn(),
    inject: vi.fn(),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  } as unknown as Context
  return { ctx, registeredTools }
}

function createMockExec(hasAgent = true, signal = new AbortController().signal): ToolRunContext {
  const base: ToolRunContext = {
    callId: 'call_123',
    name: 'mineru_tool',
    arguments: {},
    signal,
  }
  if (!hasAgent) return base
  return {
    ...base,
    agent: {
      id: 'agent_001',
      session: {
        id: 'session_001',
        header: { id: 'session_001', cwd: '/workspace' },
      },
    },
  }
}

function assertAllObjectSchemasClosed(schema: ValueSchemaSpec, path = 'root'): void {
  if ('oneOf' in schema && schema.oneOf) {
    schema.oneOf.forEach((sub, i) => assertAllObjectSchemasClosed(sub, path + '.oneOf[' + i + ']'))
    return
  }
  if ('type' in schema) {
    if (schema.type === 'object') {
      const obj = schema as ObjectValueSchemaSpec
      expect(obj.additionalProperties, 'additionalProperties at ' + path + ' must be false').toBe(false)
      if (obj.properties) {
        for (const [propName, propSchema] of Object.entries(obj.properties)) {
          assertAllObjectSchemasClosed(propSchema, path + '.' + propName)
        }
      }
    } else if (schema.type === 'array') {
      const arr = schema as { type: 'array'; items?: ValueSchemaSpec }
      if (arr.items) {
        assertAllObjectSchemasClosed(arr.items, path + '[]')
      }
    }
  }
}

describe('MinerU Tool Layer (Native Background & Direct Contract)', () => {
  it('registers exactly 2 model-facing tools with disposer', async () => {
    const { ctx, registeredTools } = createMockContext()
    const mockService = {} as MinerUService
    const dispose = registerTools(ctx, () => mockService)

    expect(registeredTools).toHaveLength(2)
    const names = registeredTools.map(t => t.name)
    expect(names).toEqual([
      'async_read_pdf',
      'read_pdf',
    ])
    expect(typeof dispose).toBe('function')
    await dispose()
  })

  it('strictly enforces additionalProperties: false recursively on all output schemas', () => {
    const { ctx, registeredTools } = createMockContext()
    registerTools(ctx, () => ({} as MinerUService))

    for (const tool of registeredTools) {
      assertAllObjectSchemasClosed(tool.output.schema, tool.name + '.output.schema')
    }
  })

  it('declares isConcurrencySafe on all tools for parallel tool dispatch', () => {
    const { ctx, registeredTools } = createMockContext()
    registerTools(ctx, () => ({} as MinerUService))

    for (const tool of registeredTools) {
      expect(typeof tool.isConcurrencySafe).toBe('function')
      expect(tool.isConcurrencySafe?.({})).toBe(true)
    }
  })

  it('rejects execute on all 2 tools when agent session is missing', async () => {
    const { ctx, registeredTools } = createMockContext()
    registerTools(ctx, () => ({} as MinerUService))
    const unauthenticatedExec = createMockExec(false)

    for (const tool of registeredTools) {
      await expect(
        tool.execute({ file_paths: ['/doc.pdf'] }, unauthenticatedExec),
      ).rejects.toThrow(/UNAUTHENTICATED_SESSION/)
    }
  })

  describe('async_read_pdf (Native DSH Background Job)', () => {
    it('rejects when native DSH background jobs are unavailable', async () => {
      const { ctx, registeredTools } = createMockContext(undefined)
      registerTools(ctx, () => ({} as MinerUService))
      const submitTool = registeredTools.find(t => t.name === 'async_read_pdf')!
      const exec = createMockExec(true)

      await expect(submitTool.execute({ file_paths: ['/doc.pdf'] }, exec)).rejects.toMatchObject({
        failure: { code: 'PROVIDER_UNAVAILABLE' },
      })
    })

    it('rejects immediately when exec signal is already aborted', async () => {
      const { registry } = createMockJobRegistry()
      const { ctx, registeredTools } = createMockContext(registry)
      registerTools(ctx, () => ({} as MinerUService))
      const submitTool = registeredTools.find(t => t.name === 'async_read_pdf')!

      const controller = new AbortController()
      controller.abort()
      const exec = createMockExec(true, controller.signal)

      await expect(submitTool.execute({ file_paths: ['/doc.pdf'] }, exec)).rejects.toThrow()
      expect(registry.start).not.toHaveBeenCalled()
    })

    it('submits native background job, captures start spec, and returns immediate mineru-N ID', async () => {
      const { registry, specs } = createMockJobRegistry()
      const { ctx, registeredTools } = createMockContext(registry)
      const mockService = {
        parseDocument: vi.fn(),
      } as unknown as MinerUService
      registerTools(ctx, () => mockService)
      const submitTool = registeredTools.find(t => t.name === 'async_read_pdf')!

      const exec = createMockExec(true)
      const inputArgs = {
        file_paths: ['/data/one.pdf', '/data/two.pdf'],
        model: 'vlm' as const,
        ocr: true,
        language: 'en',
        formula: true,
        table: true,
        pages: '1-10',
        artifacts: ['markdown' as const, 'images' as const],
      }

      const result = await submitTool.execute(inputArgs, exec)
      expect(result).toEqual({ job_id: 'mineru-1', state: 'running' })
      expect(registry.start).toHaveBeenCalledTimes(1)
      expect(specs).toHaveLength(1)

      const captured = specs[0]!
      expect(captured.kind).toBe('mineru')
      expect(captured.label).toBe('Read 2 PDF documents with MinerU')
      expect(captured.owner).toBe(exec.agent)
      expect(typeof captured.run).toBe('function')

      const rendered = submitTool.output.render(inputArgs, result)
      expect(rendered[0]?.text).toBe('Started native MinerU background job mineru-1.')
    })

    it('resolves done hook with completed outcome and direct markdown content on success', async () => {
      const { registry, specs } = createMockJobRegistry()
      const { ctx, registeredTools } = createMockContext(registry)

      const completedResult: ResultView = {
        state: 'completed',
        source: 'provider',
        cache_hit: false,
        result_id: 'mr_test_123',
        files: [
          {
            file_id: 'mf_1',
            name: 'sample.pdf',
            artifacts: [{ kind: 'markdown', path: '/cache/sample/full.md', bytes: 512 }],
          },
        ],
        markdown_content: '# Background Parsed Content',
        content_status: 'complete',
        manifest_path: '/cache/sample/manifest.json',
        output_limit_chars: 2000,
      }

      const mockService = {
        parseDocument: vi.fn(async () => completedResult),
      } as unknown as MinerUService
      registerTools(ctx, () => mockService)
      const submitTool = registeredTools.find(t => t.name === 'async_read_pdf')!

      const exec = createMockExec(true)
      const inputArgs = { file_paths: ['/sample.pdf'] }
      await submitTool.execute(inputArgs, exec)

      const hooks = specs[0]!.run()
      const outcome = await hooks.done

      expect(mockService.parseDocument).toHaveBeenCalledWith(
        exec.agent?.session,
        { file_paths: ['/sample.pdf'] },
        expect.any(AbortSignal),
        null,
      )
      expect(outcome.status).toBe('completed')
      expect(outcome.detail).toBe('completed')
      expect(outcome.output).toContain('Background Parsed Content')
      expect(outcome.output).toContain('# Document: sample.pdf')
      expect(outcome.output).toContain('Status: Content complete. Full document markdown delivered above.')
      expect(outcome.output).toContain('/cache/sample/manifest.json')
    })

    it('resolves done hook with batch detail when batch parse settles', async () => {
      const { registry, specs } = createMockJobRegistry()
      const { ctx, registeredTools } = createMockContext(registry)

      const batchResult: BatchParseDocumentView = {
        kind: 'batch',
        state: 'partially-completed',
        results: [
          {
            state: 'completed',
            source: 'provider',
            cache_hit: true,
            result_id: 'mr_1',
            files: [{ file_id: 'mf_1', name: 'good.pdf', artifacts: [] }],
            markdown_content: '# Good',
            content_status: 'complete',
            manifest_path: '/cache/good/manifest.json',
            output_limit_chars: 2000,
          },
          {
            state: 'failed',
            source: 'provider',
            file_id: 'mf_2',
            name: 'bad.pdf',
            failure: failure('REMOTE_PARSE_FAILED', 'Document corrupted'),
          },
        ],
      }

      const mockService = {
        parseDocument: vi.fn(async () => batchResult),
      } as unknown as MinerUService
      registerTools(ctx, () => mockService)
      const submitTool = registeredTools.find(t => t.name === 'async_read_pdf')!

      const exec = createMockExec(true)
      await submitTool.execute({ file_paths: ['/good.pdf', '/bad.pdf'] }, exec)

      const hooks = specs[0]!.run()
      const outcome = await hooks.done

      expect(outcome.status).toBe('completed')
      expect(outcome.detail).toBe('partially-completed')
      expect(outcome.output).toContain('**MinerU Batch Result**')
      expect(outcome.output).toContain('bad.pdf')
      expect(outcome.output).toContain('REMOTE_PARSE_FAILED')
    })

    it('marks an all-failed batch as a failed native job outcome', async () => {
      const { registry, specs } = createMockJobRegistry()
      const { ctx, registeredTools } = createMockContext(registry)
      const failedBatch: BatchParseDocumentView = {
        kind: 'batch',
        state: 'failed',
        results: [{
          state: 'failed', source: 'provider', file_id: 'mf_1', name: 'bad.pdf',
          failure: failure('REMOTE_PARSE_FAILED', 'Document corrupted'),
        }],
      }
      const mockService = { parseDocument: vi.fn(async () => failedBatch) } as unknown as MinerUService
      registerTools(ctx, () => mockService)
      const submitTool = registeredTools.find(t => t.name === 'async_read_pdf')!

      await submitTool.execute({ file_paths: ['/bad.pdf'] }, createMockExec(true))
      const outcome = await specs[0]!.run().done

      expect(outcome.status).toBe('failed')
      expect(outcome.detail).toBe('batch-failed')
      expect(outcome.output).toContain('REMOTE_PARSE_FAILED')
    })

    it('handles cancelation and resolves done with killed status', async () => {
      const { registry, specs } = createMockJobRegistry()
      const { ctx, registeredTools } = createMockContext(registry)

      const mockService = {
        parseDocument: vi.fn(async (_session, _input, signal: AbortSignal) => {
          return new Promise<ResultView>((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
            })
          })
        }),
      } as unknown as MinerUService
      registerTools(ctx, () => mockService)
      const submitTool = registeredTools.find(t => t.name === 'async_read_pdf')!

      const exec = createMockExec(true)
      await submitTool.execute({ file_paths: ['/hang.pdf'] }, exec)

      const hooks = specs[0]!.run()
      hooks.cancel('User requested cancellation')
      const outcome = await hooks.done

      expect(outcome.status).toBe('killed')
      expect(outcome.detail).toBe('cancelled')
    })

    it('cancels and awaits active native wrappers when tools are disposed', async () => {
      const { registry, specs } = createMockJobRegistry()
      const { ctx, registeredTools } = createMockContext(registry)
      const mockService = {
        parseDocument: vi.fn(async (_session, _input, signal: AbortSignal) => {
          return await new Promise<ResultView>((_resolve, reject) => {
            if (signal.aborted) { reject(signal.reason); return }
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          })
        }),
      } as unknown as MinerUService
      const dispose = registerTools(ctx, () => mockService)
      const submitTool = registeredTools.find(t => t.name === 'async_read_pdf')!

      await submitTool.execute({ file_paths: ['/hang.pdf'] }, createMockExec(true))
      const hooks = specs[0]!.run()
      await dispose()

      await expect(hooks.done).resolves.toMatchObject({ status: 'killed', detail: 'cancelled' })
    })

    it('handles parse failure and maps to failed outcome with error detail', async () => {
      const { registry, specs } = createMockJobRegistry()
      const { ctx, registeredTools } = createMockContext(registry)

      const mockService = {
        parseDocument: vi.fn(async () => {
          throw new MinerUError(failure('FILE_TOO_LARGE', 'Input exceeds limit'))
        }),
      } as unknown as MinerUService
      registerTools(ctx, () => mockService)
      const submitTool = registeredTools.find(t => t.name === 'async_read_pdf')!

      const exec = createMockExec(true)
      await submitTool.execute({ file_paths: ['/giant.pdf'] }, exec)

      const hooks = specs[0]!.run()
      const outcome = await hooks.done

      expect(outcome.status).toBe('failed')
      expect(outcome.detail).toBe('FILE_TOO_LARGE')
      expect(outcome.output).toBe('[FILE_TOO_LARGE] Input exceeds limit')
    })

    it('projects structured presentation metadata for submitted jobs', () => {
      const { ctx, registeredTools } = createMockContext()
      registerTools(ctx, () => ({} as MinerUService))
      const submitTool = registeredTools.find(t => t.name === 'async_read_pdf')!

      expect(submitTool.output.presentationMeta?.({}, { job_id: 'mineru-1', state: 'running' })).toEqual({
        job_id: 'mineru-1',
        state: 'running',
      })
    })

    it('wraps background execution with storage access gate when provided', async () => {
      const { registry, specs } = createMockJobRegistry()
      const { ctx, registeredTools } = createMockContext(registry)
      const accessGate = new StorageAccessGate()
      const runSharedSpy = vi.spyOn(accessGate, 'runShared')

      const completedResult: ResultView = {
        state: 'completed',
        source: 'cache',
        cache_hit: true,
        result_id: 'mr_gate_1',
        files: [],
        content_status: 'complete',
        manifest_path: '/cache/manifest.json',
        output_limit_chars: 1000,
      }
      const mockService = {
        parseDocument: vi.fn(async () => completedResult),
      } as unknown as MinerUService

      registerTools(ctx, () => mockService, accessGate)
      const submitTool = registeredTools.find(t => t.name === 'async_read_pdf')!

      const exec = createMockExec(true)
      await submitTool.execute({ file_paths: ['/doc.pdf'] }, exec)

      const hooks = specs[0]!.run()
      const outcome = await hooks.done

      expect(outcome.status).toBe('completed')
      expect(runSharedSpy).toHaveBeenCalled()
    })
  })

  describe('read_pdf (Direct Result, No Plugin Job)', () => {
    it('executes synchronous direct parseDocument and returns direct result', async () => {
      const completedResult: ResultView = {
        state: 'completed',
        source: 'provider',
        cache_hit: false,
        result_id: 'mr_sync_1',
        files: [
          {
            file_id: 'mf_1',
            name: 'sync.pdf',
            artifacts: [{ kind: 'markdown', path: '/cache/sync/full.md', bytes: 100 }],
          },
        ],
        markdown_content: '# Synchronous Direct Result',
        content_status: 'complete',
        manifest_path: '/cache/sync/manifest.json',
        output_limit_chars: 2000,
      }
      const mockService = {
        parseDocument: vi.fn(async () => completedResult),
      } as unknown as MinerUService

      const { ctx, registeredTools } = createMockContext()
      registerTools(ctx, () => mockService)
      const parseTool = registeredTools.find(t => t.name === 'read_pdf')!

      const exec = createMockExec(true)
      const args = { file_paths: ['/sync.pdf'], poll_timeout_ms: 30000 }
      const result = await parseTool.execute(args, exec)

      expect(mockService.parseDocument).toHaveBeenCalledWith(
        exec.agent?.session,
        { file_paths: ['/sync.pdf'] },
        exec.signal,
        30000,
      )
      expect(result).toEqual(completedResult)

      const rendered = parseTool.output.render(args, result)
      expect(rendered[0]?.text).toContain('Synchronous Direct Result')
      expect(rendered[0]?.text).toContain('# Document: sync.pdf')
      expect(rendered[0]?.text).toContain('**MinerU Parse Result** (Source: provider, Cache: miss)')
      expect(rendered[0]?.text).toContain('Status: Content complete. Full document markdown delivered above.')
      expect(rendered[0]?.text).toContain('/cache/sync/manifest.json')
    })

    it('documents direct content inlining and positive usage guidance', () => {
      const { ctx, registeredTools } = createMockContext()
      registerTools(ctx, () => ({} as MinerUService))
      const parseTool = registeredTools.find(t => t.name === 'read_pdf')!
      expect(parseTool.description).toContain('When content_status is complete')
      expect(parseTool.description).toContain('markdown_content')
      expect(parseTool.description).toContain('When content_status is partial')
    })

    it('projects structured presentation metadata for single result and batch result', () => {
      const { ctx, registeredTools } = createMockContext()
      registerTools(ctx, () => ({} as MinerUService))
      const parseTool = registeredTools.find(t => t.name === 'read_pdf')!

      const singleResult: ResultView = {
        state: 'completed',
        source: 'cache',
        cache_hit: true,
        result_id: 'mr_test_1',
        files: [{ file_id: 'mf_1', name: 'paper.pdf', artifacts: [{ kind: 'markdown', path: '/p/out.md', bytes: 50 }] }],
        manifest_path: '/p/manifest.json',
      }
      expect(parseTool.output.presentationMeta?.({}, singleResult)).toEqual({
        result_id: 'mr_test_1',
        source: 'cache',
        cache_hit: true,
        manifest_path: '/p/manifest.json',
        files: [{ file_id: 'mf_1', name: 'paper.pdf', artifacts: [{ kind: 'markdown', path: '/p/out.md', bytes: 50 }] }],
      })

      const singleWithToc: ResultView = {
        state: 'completed',
        source: 'provider',
        cache_hit: false,
        result_id: 'mr_test_toc',
        files: [{ file_id: 'mf_1', name: 'paper.pdf', artifacts: [] }],
        manifest_path: '/p/manifest.json',
        content_status: 'partial',
        output_limit_chars: 2000,
        toc: [
          { level: 1, title: 'Introduction', line: 1 },
          { level: 2, title: 'Background', line: 15 },
        ],
      }
      expect(parseTool.output.presentationMeta?.({}, singleWithToc)).toEqual({
        result_id: 'mr_test_toc',
        source: 'provider',
        cache_hit: false,
        manifest_path: '/p/manifest.json',
        files: [{ file_id: 'mf_1', name: 'paper.pdf', artifacts: [] }],
        toc: [
          { level: 1, title: 'Introduction', line: 1 },
          { level: 2, title: 'Background', line: 15 },
        ],
      })

      const batchResult: BatchParseDocumentView = {
        kind: 'batch',
        state: 'completed',
        results: [singleResult],
      }
      expect(parseTool.output.presentationMeta?.({}, batchResult)).toEqual({
        kind: 'batch',
        state: 'completed',
        results_count: 1,
        manifests: ['/p/manifest.json'],
      })
    })

    it('rejects invalid poll timeouts before invoking the service', async () => {
      const mockService = { parseDocument: vi.fn() } as unknown as MinerUService
      const { ctx, registeredTools } = createMockContext()
      registerTools(ctx, () => mockService)
      const parseTool = registeredTools.find(t => t.name === 'read_pdf')!
      const exec = createMockExec(true)

      for (const poll_timeout_ms of [-1, 0, 86_400_001, Number.MAX_SAFE_INTEGER, 1.5, NaN]) {
        await expect(parseTool.execute({ file_paths: ['/doc.pdf'], poll_timeout_ms }, exec))
          .rejects.toMatchObject({ failure: { code: 'INVALID_REQUEST' } })
      }
      expect(mockService.parseDocument).not.toHaveBeenCalled()
    })

    it('rejects invalid non-object arguments', async () => {
      const mockService = { parseDocument: vi.fn() } as unknown as MinerUService
      const { ctx, registeredTools } = createMockContext()
      registerTools(ctx, () => mockService)
      const parseTool = registeredTools.find(t => t.name === 'read_pdf')!
      const exec = createMockExec(true)

      for (const invalid of [null, undefined, 'bad', 123, []]) {
        await expect(parseTool.execute(invalid, exec))
          .rejects.toMatchObject({ failure: { code: 'INVALID_REQUEST' } })
      }
    })

    it('renders single completed result with preview truncation and limit clamping', () => {
      const resultData: ResultView = {
        state: 'completed',
        source: 'cache',
        cache_hit: true,
        result_id: 'mr_long_preview',
        files: [{ file_id: 'mf_1', name: 'doc.pdf', artifacts: [] }],
        markdown_content: 'A'.repeat(5000),
        content_status: 'partial',
        manifest_path: '/cache/doc/manifest.json',
        output_limit_chars: 150,
      }
      const rendered = renderResult(resultData)
      expect(rendered[0]?.text.length).toBeLessThanOrEqual(150)
      expect(rendered[0]?.text).toContain('[Output truncated to limit]')
    })

    it('makes structured artifact truncation explicit in rendered prose', () => {
      const rendered = renderResult({
        state: 'completed',
        source: 'provider',
        cache_hit: false,
        result_id: 'mr_truncated_artifacts',
        files: [{ file_id: 'mf_1', name: 'doc.pdf', artifacts: [], artifacts_truncated: true }],
        content_status: 'complete',
        manifest_path: '/cache/manifest.json',
        output_limit_chars: 2000,
      })
      expect(rendered[0]?.text).toContain('Artifact list truncated to output limit')
    })

    it('renders batch document results with mixed success and failure entries', () => {
      const batchResult: BatchParseDocumentView = {
        kind: 'batch',
        state: 'partially-completed',
        results: [
          {
            state: 'completed',
            source: 'provider',
            cache_hit: false,
            result_id: 'mr_b1',
            files: [{ file_id: 'mf_1', name: 'file1.pdf', artifacts: [{ kind: 'markdown', path: '/p1.md', bytes: 10 }] }],
            markdown_content: '# P1',
            content_status: 'complete',
            manifest_path: '/m1.json',
            output_limit_chars: 1000,
          },
          {
            state: 'failed',
            source: 'provider',
            file_id: 'mf_2',
            name: 'file2.pdf',
            failure: failure('REMOTE_PARSE_FAILED', 'Extraction failed'),
          },
        ],
      }
      const rendered = renderParseDocument(batchResult)
      expect(rendered[0]?.text).toContain('**MinerU Batch Result**')
      expect(rendered[0]?.text).toContain('- State: partially-completed')
      expect(rendered[0]?.text).toContain('- Results: 2')
      expect(rendered[0]?.text).toContain('file1.pdf')
      expect(rendered[0]?.text).toContain('# P1')
      expect(rendered[0]?.text).toContain('Status: Content complete. Full document markdown delivered above.')
      expect(rendered[0]?.text).toContain('/m1.json')
      expect(rendered[0]?.text).toContain('file2.pdf')
      expect(rendered[0]?.text).toContain('REMOTE_PARSE_FAILED')
    })

    it('renders truncation footer with markdown artifact path when content_status is partial', () => {
      const resultData: ResultView = {
        state: 'completed',
        source: 'provider',
        cache_hit: false,
        result_id: 'mr_trunc',
        files: [{ file_id: 'mf_1', name: 'doc.pdf', artifacts: [{ kind: 'markdown', path: '/cache/doc/full.md', bytes: 5000 }] }],
        markdown_content: '# Truncated Content',
        content_status: 'partial',
        manifest_path: '/cache/doc/manifest.json',
        output_limit_chars: 2000,
      }
      const rendered = renderResult(resultData)
      expect(rendered[0]?.text).toContain('Status: Content partial (truncated to output limit)')
      expect(rendered[0]?.text).toContain('Full markdown artifact at: /cache/doc/full.md')
      expect(rendered[0]?.text).toContain('Manifest: /cache/doc/manifest.json')
    })

    it('renders secondary artifacts compactly when present', () => {
      const resultData: ResultView = {
        state: 'completed',
        source: 'provider',
        cache_hit: false,
        result_id: 'mr_secondary',
        files: [{
          file_id: 'mf_1',
          name: 'doc.pdf',
          artifacts: [
            { kind: 'markdown', path: '/cache/doc/full.md', bytes: 500 },
            { kind: 'layout', path: '/cache/doc/layout.json', bytes: 200 },
            { kind: 'images', path: '/cache/doc/images', bytes: 800 },
          ],
        }],
        markdown_content: '# Document with Secondary Artifacts',
        content_status: 'complete',
        manifest_path: '/cache/doc/manifest.json',
        output_limit_chars: 2000,
      }
      const rendered = renderResult(resultData)
      expect(rendered[0]?.text).toContain('Artifacts: layout (200 bytes): /cache/doc/layout.json, images (800 bytes): /cache/doc/images')
      expect(rendered[0]?.text).toContain('Status: Content complete. Full document markdown delivered above.')
      expect(rendered[0]?.text).toContain('/cache/doc/manifest.json')
    })
    it('renders clean message when markdown was not requested and does NOT claim complete delivery', () => {
      const resultData: ResultView = {
        state: 'completed',
        source: 'provider',
        cache_hit: false,
        result_id: 'mr_no_md',
        files: [{
          file_id: 'mf_1',
          name: 'scan.pdf',
          artifacts: [
            { kind: 'layout', path: '/cache/scan/layout.json', bytes: 300 },
            { kind: 'images', path: '/cache/scan/images', bytes: 1200 },
          ],
        }],
        content_status: 'not_requested',
        manifest_path: '/cache/scan/manifest.json',
        output_limit_chars: 2000,
      }
      const rendered = renderResult(resultData)
      expect(rendered[0]?.text).not.toContain('Content complete')
      expect(rendered[0]?.text).not.toContain('Complete document content delivered')
      expect(rendered[0]?.text).toContain('Status: Markdown content was not requested')
      expect(rendered[0]?.text).toContain('Manifest: /cache/scan/manifest.json')
      expect(rendered[0]?.text).toContain('Artifacts: layout (300 bytes): /cache/scan/layout.json, images (1200 bytes): /cache/scan/images')
    })

    it('renders resume offset line when content is partial and read_offset_line is present', () => {
      const resultData: ResultView = {
        state: 'completed',
        source: 'provider',
        cache_hit: false,
        result_id: 'mr_resume',
        files: [{
          file_id: 'mf_1',
          name: 'doc.pdf',
          artifacts: [{ kind: 'markdown', path: '/cache/doc/full.md', bytes: 8000 }],
        }],
        markdown_content: '# First Part of Text\nLine 2',
        content_status: 'partial',
        markdown_path: '/cache/doc/full.md',
        read_offset_line: 42,
        manifest_path: '/cache/doc/manifest.json',
        output_limit_chars: 2000,
      }
      const rendered = renderResult(resultData)
      expect(rendered[0]?.text).toContain('Status: Content partial (truncated to output limit)')
      expect(rendered[0]?.text).toContain('Full markdown artifact at: /cache/doc/full.md (resume line: offset=42).')
      expect(rendered[0]?.text).toContain('Manifest: /cache/doc/manifest.json')
    })

    it('does not clamp batch text at 16,384 when output_limit_chars is larger', () => {
      const longText1 = 'A'.repeat(20000)
      const longText2 = 'B'.repeat(20000)
      const batchResult: BatchParseDocumentView = {
        kind: 'batch',
        state: 'completed',
        output_limit_chars: 100000,
        content_status: 'complete',
        results: [
          {
            state: 'completed',
            source: 'provider',
            cache_hit: false,
            result_id: 'mr_1',
            files: [{ file_id: 'mf_1', name: 'f1.pdf', artifacts: [] }],
            markdown_content: longText1,
            content_status: 'complete',
            manifest_path: '/cache/f1/manifest.json',
            output_limit_chars: 100000,
          },
          {
            state: 'completed',
            source: 'provider',
            cache_hit: false,
            result_id: 'mr_2',
            files: [{ file_id: 'mf_2', name: 'f2.pdf', artifacts: [] }],
            markdown_content: longText2,
            content_status: 'complete',
            manifest_path: '/cache/f2/manifest.json',
            output_limit_chars: 100000,
          },
        ],
      }
      const rendered = renderParseDocument(batchResult)
      expect(rendered[0]?.text.length).toBeGreaterThan(40000)
      expect(rendered[0]?.text).not.toContain('[Output truncated to limit]')
      expect(rendered[0]?.text).toContain(longText1)
      expect(rendered[0]?.text).toContain(longText2)
    })

    it('preserves all batch documents and failure items without silently eating them', () => {
      const batchResult: BatchParseDocumentView = {
        kind: 'batch',
        state: 'partially-completed',
        output_limit_chars: 50000,
        content_status: 'partial',
        results: [
          {
            state: 'completed',
            source: 'provider',
            cache_hit: false,
            result_id: 'mr_1',
            files: [{ file_id: 'mf_1', name: 'doc1.pdf', artifacts: [] }],
            markdown_content: '# Doc 1 Content',
            content_status: 'complete',
            manifest_path: '/cache/doc1/manifest.json',
            output_limit_chars: 50000,
          },
          {
            state: 'failed',
            source: 'provider',
            file_id: 'mf_2',
            name: 'doc2.pdf',
            failure: failure('CORRUPT_FILE', 'File is corrupted and unreadable'),
          },
          {
            state: 'completed',
            source: 'provider',
            cache_hit: false,
            result_id: 'mr_3',
            files: [{ file_id: 'mf_3', name: 'doc3.pdf', artifacts: [] }],
            markdown_content: '# Doc 3 Content',
            content_status: 'complete',
            manifest_path: '/cache/doc3/manifest.json',
            output_limit_chars: 50000,
          },
        ],
      }
      const rendered = renderParseDocument(batchResult)
      const text = rendered[0]?.text ?? ''
      expect(text).toContain('doc1.pdf')
      expect(text).toContain('# Doc 1 Content')
      expect(text).toContain('doc2.pdf')
      expect(text).toContain('[CORRUPT_FILE] File is corrupted and unreadable')
      expect(text).toContain('doc3.pdf')
      expect(text).toContain('# Doc 3 Content')
    })
    it('renders inlined image ContentBlocks alongside text block', () => {
      const resultData: ResultView = {
        state: 'completed',
        source: 'provider',
        cache_hit: false,
        result_id: 'mr_with_img',
        files: [{ file_id: 'mf_1', name: 'doc.pdf', artifacts: [] }],
        markdown_content: '# Visual Doc',
        content_status: 'complete',
        manifest_path: '/cache/doc/manifest.json',
        output_limit_chars: 2000,
        inlined_images: [
          {
            attachment_id: 'att_123',
            name: 'figure1.png',
            media_type: 'image/png',
            width: 800,
            height: 600,
            bytes: 12345,
            attachmentRef: {
              attachmentId: 'att_123' as any,
              mediaType: 'image/png',
              bytes: 12345,
              width: 800,
              height: 600,
              name: 'figure1.png',
            },
          },
        ],
      }
      const rendered = renderResult(resultData)
      expect(rendered).toHaveLength(2)
      expect(rendered[0]).toMatchObject({ type: 'text' })
      expect((rendered[0] as any).text).toContain('Inlined Visual Figures')
      expect((rendered[0] as any).text).toContain('Attached Image #1: figure1.png (800x600)')
      expect(rendered[1]).toEqual({
        type: 'image',
        attachment: resultData.inlined_images![0]!.attachmentRef,
      })
    })

    it('renders document outline and guidance hint in prose when content_status is partial and toc has entries', () => {
      const resultData: ResultView = {
        state: 'completed',
        source: 'provider',
        cache_hit: false,
        result_id: 'mr_toc',
        files: [{
          file_id: 'mf_1',
          name: 'paper.pdf',
          artifacts: [{ kind: 'markdown', path: '/cache/paper/full.md', bytes: 15000 }],
        }],
        markdown_content: '# Introduction\nThis is the beginning...',
        content_status: 'partial',
        markdown_path: '/cache/paper/full.md',
        read_offset_line: 25,
        manifest_path: '/cache/paper/manifest.json',
        output_limit_chars: 2000,
        toc: [
          { level: 1, title: 'Introduction', line: 1 },
          { level: 2, title: 'Prior Work', line: 15 },
          { level: 2, title: 'Methodology', line: 45 },
          { level: 3, title: 'Dataset Collection', line: 70 },
          { level: 1, title: 'Experiments', line: 120 },
        ],
      }
      const rendered = renderResult(resultData)
      const text = rendered[0]?.text ?? ''
      expect(text).toContain('Document Outline:')
      expect(text).toContain('- Introduction (line 1)')
      expect(text).toContain('  - Prior Work (line 15)')
      expect(text).toContain('  - Methodology (line 45)')
      expect(text).toContain('    - Dataset Collection (line 70)')
      expect(text).toContain('- Experiments (line 120)')
      expect(text).toContain('Note: To read specific sections, call read_pdf with pages="X-Y" or use the read tool starting from the given line offset.')
      expect(text).toContain('Status: Content partial (truncated to output limit)')
    })

    it('does not render document outline when content_status is partial but toc is empty', () => {
      const resultData: ResultView = {
        state: 'completed',
        source: 'provider',
        cache_hit: false,
        result_id: 'mr_no_toc',
        files: [{
          file_id: 'mf_1',
          name: 'doc.pdf',
          artifacts: [{ kind: 'markdown', path: '/cache/doc/full.md', bytes: 5000 }],
        }],
        markdown_content: 'Some plain text...',
        content_status: 'partial',
        markdown_path: '/cache/doc/full.md',
        read_offset_line: 10,
        manifest_path: '/cache/doc/manifest.json',
        output_limit_chars: 2000,
        toc: [],
      }
      const rendered = renderResult(resultData)
      const text = rendered[0]?.text ?? ''
      expect(text).not.toContain('Document Outline')
      expect(text).not.toContain('Note: To read specific sections')
      expect(text).toContain('Status: Content partial (truncated to output limit)')
    })

    it('does not render document outline when content_status is complete even if toc is present', () => {
      const resultData: ResultView = {
        state: 'completed',
        source: 'provider',
        cache_hit: false,
        result_id: 'mr_complete_toc',
        files: [{
          file_id: 'mf_1',
          name: 'doc.pdf',
          artifacts: [{ kind: 'markdown', path: '/cache/doc/full.md', bytes: 500 }],
        }],
        markdown_content: '# Heading 1\nContent',
        content_status: 'complete',
        manifest_path: '/cache/doc/manifest.json',
        output_limit_chars: 2000,
        toc: [{ level: 1, title: 'Heading 1', line: 1 }],
      }
      const rendered = renderResult(resultData)
      const text = rendered[0]?.text ?? ''
      expect(text).not.toContain('Document Outline')
      expect(text).toContain('Status: Content complete. Full document markdown delivered above.')
    })
  })
})
