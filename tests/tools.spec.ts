import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-tools', () => ({
  defineTool: <T>(options: T): T => options,
}))

import {
  registerTools,
  renderHealth,
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
  ProbeView,
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

describe('MinerU Tool Layer (3-Tool Native Background & Direct Contract)', () => {
  it('registers exactly 3 model-facing tools with disposer', async () => {
    const { ctx, registeredTools } = createMockContext()
    const mockService = {} as MinerUService
    const dispose = registerTools(ctx, () => mockService)

    expect(registeredTools).toHaveLength(3)
    const names = registeredTools.map(t => t.name)
    expect(names).toEqual([
      'mineru_health',
      'mineru_submit_parse_job',
      'mineru_parse_document',
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

  it('rejects execute on all 3 tools when agent session is missing', async () => {
    const { ctx, registeredTools } = createMockContext()
    registerTools(ctx, () => ({} as MinerUService))
    const unauthenticatedExec = createMockExec(false)

    for (const tool of registeredTools) {
      await expect(
        tool.execute({ file_paths: ['/doc.pdf'] }, unauthenticatedExec),
      ).rejects.toThrow(/UNAUTHENTICATED_SESSION/)
    }
  })

  describe('mineru_health', () => {
    it('executes probe via service and passes signal', async () => {
      const probeResult: ProbeView = {
        available: true,
        provider: 'official-v4',
        authentication: 'valid',
        protocol_version: 'v4',
        server_version: '4.1.0',
        queue: { queued: 2, processing: 1, completed: 10, failed: 0, max_concurrent: 5 },
        diagnostics: 'All systems operational',
      }
      const mockService = {
        probe: vi.fn(async () => probeResult),
      } as unknown as MinerUService

      const { ctx, registeredTools } = createMockContext()
      registerTools(ctx, () => mockService)
      const healthTool = registeredTools.find(t => t.name === 'mineru_health')!

      const controller = new AbortController()
      const exec = createMockExec(true, controller.signal)
      const result = await healthTool.execute({}, exec)

      expect(mockService.probe).toHaveBeenCalledWith(controller.signal)
      expect(result).toEqual(probeResult)

      const rendered = healthTool.output.render({}, result)
      expect(rendered).toHaveLength(1)
      expect(rendered[0]?.text).toContain('Available')
      expect(rendered[0]?.text).toContain('official-v4')
      expect(rendered[0]?.text).toContain('queued=2')
      expect(rendered[0]?.text).toContain('All systems operational')
    })

    it('renders minimal health view cleanly when optional fields are omitted', () => {
      const minimalProbe: ProbeView = {
        available: false,
        provider: 'self-hosted-v2',
        authentication: 'not-configured',
        protocol_version: 'v2',
      }
      const rendered = renderHealth(minimalProbe)
      expect(rendered[0]?.text).toContain('Unavailable')
      expect(rendered[0]?.text).toContain('self-hosted-v2')
      expect(rendered[0]?.text).toContain('not-configured')
      expect(rendered[0]?.text).not.toContain('Server Version')
      expect(rendered[0]?.text).not.toContain('Queue:')
    })

    it('projects structured presentation metadata', () => {
      const { ctx, registeredTools } = createMockContext()
      registerTools(ctx, () => ({} as MinerUService))
      const healthTool = registeredTools.find(t => t.name === 'mineru_health')!

      const probeResult: ProbeView = {
        available: true,
        provider: 'official-v4',
        authentication: 'valid',
        protocol_version: 'v4',
        server_version: '4.1.0',
      }
      expect(healthTool.output.presentationMeta?.({}, probeResult)).toEqual({
        available: true,
        provider: 'official-v4',
        authentication: 'valid',
        protocol_version: 'v4',
        server_version: '4.1.0',
      })
    })
  })

  describe('mineru_submit_parse_job (Native DSH Background Job)', () => {
    it('rejects when native DSH background jobs are unavailable', async () => {
      const { ctx, registeredTools } = createMockContext(undefined)
      registerTools(ctx, () => ({} as MinerUService))
      const submitTool = registeredTools.find(t => t.name === 'mineru_submit_parse_job')!
      const exec = createMockExec(true)

      await expect(submitTool.execute({ file_paths: ['/doc.pdf'] }, exec)).rejects.toMatchObject({
        failure: { code: 'PROVIDER_UNAVAILABLE' },
      })
    })

    it('rejects immediately when exec signal is already aborted', async () => {
      const { registry } = createMockJobRegistry()
      const { ctx, registeredTools } = createMockContext(registry)
      registerTools(ctx, () => ({} as MinerUService))
      const submitTool = registeredTools.find(t => t.name === 'mineru_submit_parse_job')!

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
      const submitTool = registeredTools.find(t => t.name === 'mineru_submit_parse_job')!

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
      expect(captured.label).toBe('Parse 2 documents with MinerU')
      expect(captured.owner).toBe(exec.agent)
      expect(typeof captured.run).toBe('function')

      const rendered = submitTool.output.render(inputArgs, result)
      expect(rendered[0]?.text).toBe('Started native MinerU background job mineru-1.')
    })

    it('resolves done hook with completed outcome and formatted markdown preview on success', async () => {
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
        markdown_preview: '# Background Parsed Content',
        preview_truncated: false,
        manifest_path: '/cache/sample/manifest.json',
        output_limit_chars: 2000,
      }

      const mockService = {
        parseDocument: vi.fn(async () => completedResult),
      } as unknown as MinerUService
      registerTools(ctx, () => mockService)
      const submitTool = registeredTools.find(t => t.name === 'mineru_submit_parse_job')!

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
      expect(outcome.output).toContain('/cache/sample/full.md')
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
            markdown_preview: '# Good',
            preview_truncated: false,
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
      const submitTool = registeredTools.find(t => t.name === 'mineru_submit_parse_job')!

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
      const submitTool = registeredTools.find(t => t.name === 'mineru_submit_parse_job')!

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
      const submitTool = registeredTools.find(t => t.name === 'mineru_submit_parse_job')!

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
      const submitTool = registeredTools.find(t => t.name === 'mineru_submit_parse_job')!

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
      const submitTool = registeredTools.find(t => t.name === 'mineru_submit_parse_job')!

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
      const submitTool = registeredTools.find(t => t.name === 'mineru_submit_parse_job')!

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
        preview_truncated: false,
        manifest_path: '/cache/manifest.json',
        output_limit_chars: 1000,
      }
      const mockService = {
        parseDocument: vi.fn(async () => completedResult),
      } as unknown as MinerUService

      registerTools(ctx, () => mockService, accessGate)
      const submitTool = registeredTools.find(t => t.name === 'mineru_submit_parse_job')!

      const exec = createMockExec(true)
      await submitTool.execute({ file_paths: ['/doc.pdf'] }, exec)

      const hooks = specs[0]!.run()
      const outcome = await hooks.done

      expect(outcome.status).toBe('completed')
      expect(runSharedSpy).toHaveBeenCalled()
    })
  })

  describe('mineru_parse_document (Direct Result, No Plugin Job)', () => {
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
        markdown_preview: '# Synchronous Direct Result',
        preview_truncated: false,
        manifest_path: '/cache/sync/manifest.json',
        output_limit_chars: 2000,
      }
      const mockService = {
        parseDocument: vi.fn(async () => completedResult),
      } as unknown as MinerUService

      const { ctx, registeredTools } = createMockContext()
      registerTools(ctx, () => mockService)
      const parseTool = registeredTools.find(t => t.name === 'mineru_parse_document')!

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
      expect(rendered[0]?.text).toContain('/cache/sync/full.md')
      expect(rendered[0]?.text).toContain('Cache Hit: No')
    })

    it('projects structured presentation metadata for single result and batch result', () => {
      const { ctx, registeredTools } = createMockContext()
      registerTools(ctx, () => ({} as MinerUService))
      const parseTool = registeredTools.find(t => t.name === 'mineru_parse_document')!

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
      const parseTool = registeredTools.find(t => t.name === 'mineru_parse_document')!
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
      const parseTool = registeredTools.find(t => t.name === 'mineru_parse_document')!
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
        markdown_preview: 'A'.repeat(5000),
        preview_truncated: true,
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
        preview_truncated: false,
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
            markdown_preview: '# P1',
            preview_truncated: false,
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
      expect(rendered[0]?.text).toContain('/p1.md')
      expect(rendered[0]?.text).toContain('file2.pdf')
      expect(rendered[0]?.text).toContain('REMOTE_PARSE_FAILED')
    })
  })
})
