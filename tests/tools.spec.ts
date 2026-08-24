import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-tools', () => ({
  defineTool: <T>(options: T): T => options,
}))

import { registerTools, renderHealth, renderSubmit, renderStatus, renderResult, renderParseDocument } from '../src/tools.js'
import type { Context } from 'cordis'
import type { DefineToolOptions, ObjectValueSchemaSpec, ToolRunContext, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type {
  MinerUService,
  ParseDocumentView,
  ProbeView,
  ResultView,
  StatusView,
  SubmitView,
} from '../src/service/mineru-service.js'

function createMockContext() {
  const registeredTools: DefineToolOptions[] = []
  const ctx = {
    tools: {
      register: vi.fn((def: DefineToolOptions) => {
        registeredTools.push(def)
        return vi.fn()
      }),
      schemas: vi.fn(() => []),
    },
    get: vi.fn(),
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
      id: 'session_001',
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

describe('MinerU Tool Layer', () => {
  it('registers all 5 model-facing tools with disposer', () => {
    const { ctx, registeredTools } = createMockContext()
    const mockService = {} as MinerUService
    const dispose = registerTools(ctx, () => mockService)

    expect(registeredTools).toHaveLength(5)
    const names = registeredTools.map(t => t.name)
    expect(names).toEqual([
      'mineru_health',
      'mineru_submit_parse_job',
      'mineru_get_parse_status',
      'mineru_get_parse_result',
      'mineru_parse_document',
    ])
    expect(typeof dispose).toBe('function')
    dispose()
  })

  it('strictly enforces additionalProperties: false recursively on all output schemas', () => {
    const { ctx, registeredTools } = createMockContext()
    registerTools(ctx, () => ({} as MinerUService))

    for (const tool of registeredTools) {
      assertAllObjectSchemasClosed(tool.output.schema, tool.name + '.output.schema')
    }
  })

  it('rejects execute on all 5 tools when agent session is missing', async () => {
    const { ctx, registeredTools } = createMockContext()
    registerTools(ctx, () => ({} as MinerUService))
    const unauthenticatedExec = createMockExec(false)

    for (const tool of registeredTools) {
      await expect(
        tool.execute({ job_id: 'mj_123', file_paths: ['/doc.pdf'] }, unauthenticatedExec),
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
    })
  })

  describe('mineru_submit_parse_job', () => {
    it('submits parse request and passes input and session to service', async () => {
      const submitResult: SubmitView = {
        job_id: 'mj_submit_123',
        state: 'queued',
        source: 'provider',
        provider: 'self-hosted-v2',
        files: [{ file_id: 'mf_1', name: 'doc.pdf', state: 'queued' }],
        result_available: false,
      }
      const mockService = {
        submit: vi.fn(async () => submitResult),
      } as unknown as MinerUService

      const { ctx, registeredTools } = createMockContext()
      registerTools(ctx, () => mockService)
      const submitTool = registeredTools.find(t => t.name === 'mineru_submit_parse_job')!

      const controller = new AbortController()
      const exec = createMockExec(true, controller.signal)
      const inputArgs = {
        file_paths: ['/data/doc.pdf'],
        model: 'pipeline' as const,
        ocr: true,
        language: 'ch',
        formula: true,
        table: true,
        pages: '1-5',
        artifacts: ['markdown' as const, 'layout' as const],
      }

      const result = await submitTool.execute(inputArgs, exec)
      expect(mockService.submit).toHaveBeenCalledWith(exec.agent?.session, inputArgs, controller.signal)
      expect(result).toEqual(submitResult)

      const rendered = submitTool.output.render(inputArgs, result)
      expect(rendered[0]?.text).toContain('mj_submit_123')
      expect(rendered[0]?.text).toContain('queued')
      expect(rendered[0]?.text).toContain('doc.pdf')
    })

  })

  describe('mineru_get_parse_status', () => {
    it('accepts job_id and routes to service.status', async () => {
      const statusResult: StatusView = {
        job_id: 'mj_status_123',
        state: 'processing',
        source: 'provider',
        provider: 'official-v4',
        files: [{ file_id: 'mf_1', name: 'paper.pdf', state: 'processing', progress: { completed: 3, total: 10 } }],
        result_available: false,
        created_at: 1700000000000,
        updated_at: 1700000005000,
      }
      const mockService = {
        status: vi.fn(async () => statusResult),
      } as unknown as MinerUService

      const { ctx, registeredTools } = createMockContext()
      registerTools(ctx, () => mockService)
      const statusTool = registeredTools.find(t => t.name === 'mineru_get_parse_status')!

      const exec = createMockExec(true)
      const result = await statusTool.execute({ job_id: 'mj_status_123' }, exec)

      expect(mockService.status).toHaveBeenCalledWith(exec.agent?.session, 'mj_status_123', exec.signal)
      expect(result).toEqual(statusResult)

      const rendered = statusTool.output.render({ job_id: 'mj_status_123' }, result)
      expect(rendered[0]?.text).toContain('mj_status_123')
      expect(rendered[0]?.text).toContain('progress: 3/10')
    })

    it('rejects a missing job_id', async () => {
      const mockService = { status: vi.fn() } as unknown as MinerUService
      const { ctx, registeredTools } = createMockContext()
      registerTools(ctx, () => mockService)
      const statusTool = registeredTools.find(t => t.name === 'mineru_get_parse_status')!
      const exec = createMockExec(true)
      await expect(statusTool.execute({}, exec)).rejects.toThrow(/job_id is required/)
      await expect(statusTool.execute({ task_id: 'mj_removed' }, exec)).rejects.toThrow(/Unsupported tool argument/)
      expect(mockService.status).not.toHaveBeenCalled()
    })
  })

  describe('mineru_get_parse_result', () => {
    it('fetches result and renders preview, artifacts, and clamps to output_limit_chars', async () => {
      const resultData: ResultView = {
        job_id: 'mj_res_123',
        state: 'completed',
        cache_hit: true,
        result_id: 'mr_res_123',
        files: [
          {
            file_id: 'mf_1',
            name: 'doc.pdf',
            artifacts: [
              { kind: 'markdown', path: '/cache/doc/full.md', bytes: 1024 },
              { kind: 'images', path: '/cache/doc/images/0.png', bytes: 2048 },
            ],
          },
        ],
        markdown_preview: '# Document Heading\n\nExtracted document text content.',
        preview_truncated: false,
        manifest_path: '/cache/doc/manifest.json',
        output_limit_chars: 1000,
      }
      const mockService = {
        result: vi.fn(async () => resultData),
      } as unknown as MinerUService

      const { ctx, registeredTools } = createMockContext()
      registerTools(ctx, () => mockService)
      const resultTool = registeredTools.find(t => t.name === 'mineru_get_parse_result')!

      const exec = createMockExec(true)
      const result = await resultTool.execute({ job_id: 'mj_res_123' }, exec)
      expect(mockService.result).toHaveBeenCalledWith(exec.agent?.session, 'mj_res_123', exec.signal)

      const rendered = resultTool.output.render({ job_id: 'mj_res_123' }, result)
      expect(rendered[0]?.text).toContain('mj_res_123')
      expect(rendered[0]?.text).toContain('Document Heading')
      expect(rendered[0]?.text).toContain('/cache/doc/full.md')
    })

    it('truncates render projection when text exceeds output_limit_chars', () => {
      const resultData: ResultView = {
        job_id: 'mj_long',
        state: 'completed',
        cache_hit: false,
        result_id: 'mr_long',
        files: [{ file_id: 'mf_1', name: 'big.pdf', artifacts: [] }],
        markdown_preview: 'A'.repeat(5000),
        preview_truncated: false,
        manifest_path: '/cache/manifest.json',
        output_limit_chars: 120,
      }
      const rendered = renderResult(resultData)
      expect(rendered[0]?.text.length).toBeLessThanOrEqual(120)
      expect(rendered[0]?.text).toContain('[Output truncated to limit]')
    })
  })


    it('makes structured artifact truncation explicit in rendered prose', () => {
      const rendered = renderResult({
        job_id: 'mj_artifacts', state: 'completed', cache_hit: false, result_id: 'mr_artifacts',
        files: [{ file_id: 'mf_1', name: 'doc.pdf', artifacts: [], artifacts_truncated: true }],
        preview_truncated: false, manifest_path: '/cache/manifest.json', output_limit_chars: 2000,
      })
      expect(rendered[0]?.text).toContain('Artifact list truncated')
    })

  describe('mineru_parse_document', () => {
    it('executes folded parseDocument and returns result on completion', async () => {
      const completedResult: ResultView = {
        job_id: 'mj_sync_1',
        state: 'completed',
        cache_hit: false,
        result_id: 'mr_sync_1',
        files: [{ file_id: 'mf_1', name: 'sync.pdf', artifacts: [] }],
        markdown_preview: '# Synchronous Content',
        preview_truncated: false,
        manifest_path: '/cache/manifest.json',
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
        exec.agent?.session, { file_paths: ['/sync.pdf'] }, exec.signal, 30000,
      )
      expect(result).toEqual(completedResult)

      const rendered = parseTool.output.render(args, result)
      expect(rendered[0]?.text).toContain('Synchronous Content')
    })


    it('rejects invalid poll timeouts before invoking the service', async () => {
      const mockService = { parseDocument: vi.fn() } as unknown as MinerUService
      const { ctx, registeredTools } = createMockContext()
      registerTools(ctx, () => mockService)
      const parseTool = registeredTools.find(t => t.name === 'mineru_parse_document')!
      const exec = createMockExec(true)
      for (const poll_timeout_ms of [-1, 0, 86_400_001, Number.MAX_SAFE_INTEGER]) {
        await expect(parseTool.execute({ file_paths: ['/doc.pdf'], poll_timeout_ms }, exec))
          .rejects.toMatchObject({ failure: { code: 'INVALID_REQUEST' } })
      }
      expect(mockService.parseDocument).not.toHaveBeenCalled()
    })

    it('renders status view when parseDocument returns in-progress timed out status', () => {
      const timedOutStatus: ParseDocumentView = {
        job_id: 'mj_sync_timeout',
        state: 'processing',
        source: 'provider',
        provider: 'official-v4',
        files: [{ file_id: 'mf_1', name: 'large.pdf', state: 'processing' }],
        result_available: false,
        poll_timed_out: true,
        created_at: 1700000000000,
        updated_at: 1700000010000,
        failure: { code: 'POLL_TIMEOUT', message: 'Synchronous wait timed out', retryable: true },
      }
      const rendered = renderParseDocument(timedOutStatus)
      expect(rendered[0]?.text).toContain('mj_sync_timeout')
      expect(rendered[0]?.text).toContain('processing')
      expect(rendered[0]?.text).toContain('POLL_TIMEOUT')
    })
  })
})
