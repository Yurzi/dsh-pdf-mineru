import { writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-tools')>()
  return {
    ...actual,
    defineTool: <T>(options: T): T => options,
  }
})

import {
  registerTools,
  renderResult,
} from '../src/tools.js'
import type { Context } from 'cordis'
import type {
  DefineToolOptions,
  ObjectValueSchemaSpec,
  ToolRunContext,
  ValueSchemaSpec,
} from '@deepseek-ai/dsh-tools'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { isJsonValue, snapshotJsonValue } from '@deepseek-ai/dsh-util-values'
import type {
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
      'async_parse_pdf',
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
        tool.execute({ file_path: '/doc.pdf' }, unauthenticatedExec),
      ).rejects.toThrow(/UNAUTHENTICATED_SESSION/)
    }
  })

  describe('async_parse_pdf (Native DSH Background Job)', () => {
    it('rejects when native DSH background jobs are unavailable', async () => {
      const { ctx, registeredTools } = createMockContext(undefined)
      registerTools(ctx, () => ({} as MinerUService))
      const submitTool = registeredTools.find(t => t.name === 'async_parse_pdf')!
      const exec = createMockExec(true)

      await expect(submitTool.execute({ file_path: '/doc.pdf' }, exec)).rejects.toMatchObject({
        failure: { code: 'PROVIDER_UNAVAILABLE' },
      })
    })

    it('rejects immediately when exec signal is already aborted', async () => {
      const { registry } = createMockJobRegistry()
      const { ctx, registeredTools } = createMockContext(registry)
      registerTools(ctx, () => ({} as MinerUService))
      const submitTool = registeredTools.find(t => t.name === 'async_parse_pdf')!

      const controller = new AbortController()
      controller.abort()
      const exec = createMockExec(true, controller.signal)

      await expect(submitTool.execute({ file_path: '/doc.pdf' }, exec)).rejects.toThrow()
      expect(registry.start).not.toHaveBeenCalled()
    })

    it('submits native background job, captures start spec, and returns immediate mineru-N ID', async () => {
      const { registry, specs } = createMockJobRegistry()
      const { ctx, registeredTools } = createMockContext(registry)
      const mockService = {
        parseDocument: vi.fn(),
      } as unknown as MinerUService
      registerTools(ctx, () => mockService)
      const submitTool = registeredTools.find(t => t.name === 'async_parse_pdf')!

      const exec = createMockExec(true)
      const inputArgs = {
        file_path: '/data/one.pdf',
      }

      const result = await submitTool.execute(inputArgs, exec)
      expect(result).toEqual({ job_id: 'mineru-1', state: 'running' })
      expect(registry.start).toHaveBeenCalledTimes(1)
      expect(specs).toHaveLength(1)

      const captured = specs[0]!
      expect(captured.kind).toBe('mineru')
      expect(captured.label).toBe('Parse one.pdf with MinerU')
      expect(captured.owner).toBe(exec.agent)
      expect(typeof captured.run).toBe('function')

      const rendered = submitTool.output.render(inputArgs, result)
      expect(rendered[0]?.text).toBe('Started native MinerU background job mineru-1.')
    })

    it('resolves done hook with completed outcome and document summary on success', async () => {
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
        summary: {
          page_count: 5,
          table_count: 2,
          image_count: 3,
        },
      }

      const mockService = {
        ensureParsed: vi.fn(async () => completedResult),
      } as unknown as MinerUService
      registerTools(ctx, () => mockService)
      const submitTool = registeredTools.find(t => t.name === 'async_parse_pdf')!

      const exec = createMockExec(true)
      const inputArgs = { file_path: '/sample.pdf' }
      await submitTool.execute(inputArgs, exec)

      const hooks = specs[0]!.run()
      const outcome = await hooks.done

      expect(mockService.ensureParsed).toHaveBeenCalledWith(
        exec.agent?.session,
        { file_path: '/sample.pdf' },
        expect.any(AbortSignal),
      )
      expect(outcome.status).toBe('completed')
      expect(outcome.detail).toBe('completed')
      expect(outcome.output).toContain('MinerU Document Parse Summary')
      expect(outcome.output).toContain('sample.pdf')
      expect(outcome.output).toContain('read_pdf')
    })



    it('handles cancelation and resolves done with killed status', async () => {
      const { registry, specs } = createMockJobRegistry()
      const { ctx, registeredTools } = createMockContext(registry)

      const mockService = {
        ensureParsed: vi.fn(async (_session, _input, signal: AbortSignal) => {
          return new Promise<ResultView>((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
            })
          })
        }),
      } as unknown as MinerUService
      registerTools(ctx, () => mockService)
      const submitTool = registeredTools.find(t => t.name === 'async_parse_pdf')!

      const exec = createMockExec(true)
      await submitTool.execute({ file_path: '/hang.pdf' }, exec)

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
        ensureParsed: vi.fn(async (_session, _input, signal: AbortSignal) => {
          return await new Promise<ResultView>((_resolve, reject) => {
            if (signal.aborted) { reject(signal.reason); return }
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          })
        }),
      } as unknown as MinerUService
      const dispose = registerTools(ctx, () => mockService)
      const submitTool = registeredTools.find(t => t.name === 'async_parse_pdf')!

      await submitTool.execute({ file_path: '/hang.pdf' }, createMockExec(true))
      const hooks = specs[0]!.run()
      await dispose()

      await expect(hooks.done).resolves.toMatchObject({ status: 'killed', detail: 'cancelled' })
    })

    it('handles parse failure and maps to failed outcome with error detail', async () => {
      const { registry, specs } = createMockJobRegistry()
      const { ctx, registeredTools } = createMockContext(registry)

      const mockService = {
        ensureParsed: vi.fn(async () => {
          throw new MinerUError(failure('FILE_TOO_LARGE', 'Input exceeds limit'))
        }),
      } as unknown as MinerUService
      registerTools(ctx, () => mockService)
      const submitTool = registeredTools.find(t => t.name === 'async_parse_pdf')!

      const exec = createMockExec(true)
      await submitTool.execute({ file_path: '/giant.pdf' }, exec)

      const hooks = specs[0]!.run()
      const outcome = await hooks.done

      expect(outcome.status).toBe('failed')
      expect(outcome.detail).toBe('FILE_TOO_LARGE')
      expect(outcome.output).toBe('[FILE_TOO_LARGE] Input exceeds limit')
    })

    it('projects structured presentation metadata for submitted jobs', () => {
      const { ctx, registeredTools } = createMockContext()
      registerTools(ctx, () => ({} as MinerUService))
      const submitTool = registeredTools.find(t => t.name === 'async_parse_pdf')!

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
        ensureParsed: vi.fn(async () => completedResult),
      } as unknown as MinerUService

      registerTools(ctx, () => mockService, accessGate)
      const submitTool = registeredTools.find(t => t.name === 'async_parse_pdf')!

      const exec = createMockExec(true)
      await submitTool.execute({ file_path: '/doc.pdf' }, exec)

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
      const args = { file_path: '/sync.pdf', poll_timeout_ms: 30000 }
      const result = await parseTool.execute(args, exec)

      expect(mockService.parseDocument).toHaveBeenCalledWith(
        exec.agent?.session,
        { file_path: '/sync.pdf' },
        exec.signal,
        30000,
      )
      expect(result).toEqual(completedResult)

      const rendered = parseTool.output.render(args, result)
      expect(rendered[0]?.text).toContain('Synchronous Direct Result')
      expect(rendered[0]?.text).toContain('# Document: sync.pdf')
      expect(rendered[0]?.text).not.toContain('MinerU Parse Result')
      expect(rendered[0]?.text).toContain('Status: Content complete.')
      expect(rendered[0]?.text).toContain('Full requested document markdown delivered above.')
      expect(rendered[0]?.text).not.toContain('/cache/sync/manifest.json')
    })

    it('documents direct content inlining and positive usage guidance', () => {
      const { ctx, registeredTools } = createMockContext()
      registerTools(ctx, () => ({} as MinerUService))
      const parseTool = registeredTools.find(t => t.name === 'read_pdf')!
      expect(parseTool.description).toContain('When content_status is complete')
      expect(parseTool.description).toContain('markdown_content')
      expect(parseTool.description).toContain('When content_status is partial')
      expect(parseTool.description).not.toContain('If pre-parsed by async_parse_pdf, reads instantly from local cache.')
      expect(parseTool.description).not.toContain('reads instantly from local cache')
    })

    it('accepts single file_path parameter on both tools and normalizes appropriately', async () => {
      const { registry } = createMockJobRegistry()
      const { ctx, registeredTools } = createMockContext(registry)
      const mockService = { parseDocument: vi.fn(async () => ({ state: 'completed' as const, source: 'cache' as const, cache_hit: true, result_id: 'mr_1', files: [], content_status: 'complete' as const, manifest_path: '/p/m.json', output_limit_chars: 1000 })) } as unknown as MinerUService
      registerTools(ctx, () => mockService)
      const asyncTool = registeredTools.find(t => t.name === 'async_parse_pdf')!
      const readTool = registeredTools.find(t => t.name === 'read_pdf')!
      const exec = createMockExec(true)

      const asyncRes = await asyncTool.execute({ file_path: '/single.pdf' }, exec)
      expect(asyncRes).toMatchObject({ state: 'running' })

      await readTool.execute({ file_path: '/single.pdf' }, exec)
      expect(mockService.parseDocument).toHaveBeenCalledWith(
        exec.agent?.session,
        { file_path: '/single.pdf' },
        exec.signal,
        undefined,
      )
    })

    it('rejects removed technical parameters (model, ocr, formula, table, language, artifacts, max_inline_images)', async () => {
      const { ctx, registeredTools } = createMockContext()
      registerTools(ctx, () => ({} as MinerUService))
      const exec = createMockExec(true)
      for (const tool of registeredTools) {
        for (const param of ['model', 'ocr', 'formula', 'table', 'language', 'artifacts', 'max_inline_images']) {
          await expect(tool.execute({ file_path: '/doc.pdf', [param]: 'test' }, exec))
            .rejects.toMatchObject({ failure: { code: 'INVALID_REQUEST' } })
        }
      }
    })

    it('passes pages and focus options to mineru service in read_pdf', async () => {
      const { ctx, registeredTools } = createMockContext()
      const mockService = {
        parseDocument: vi.fn(async () => ({
          state: 'completed' as const,
          source: 'cache' as const,
          cache_hit: true,
          result_id: 'mr_1',
          files: [],
          content_status: 'complete' as const,
          manifest_path: '/cache/m.json',
          output_limit_chars: 1000,
        })),
      } as unknown as MinerUService
      registerTools(ctx, () => mockService)
      const readTool = registeredTools.find(t => t.name === 'read_pdf')!
      const exec = createMockExec(true)

      await readTool.execute({ file_path: '/paper.pdf', pages: '1-3, 5', focus: 'table' }, exec)
      expect(mockService.parseDocument).toHaveBeenCalledWith(
        exec.agent?.session,
        expect.objectContaining({
          file_path: '/paper.pdf',
          pages: '1-3, 5',
          focus: 'table',
        }),
        exec.signal,
        undefined,
      )

      await readTool.execute({ file_path: '/paper.pdf', focus: 'toc' }, exec)
      expect(mockService.parseDocument).toHaveBeenCalledWith(
        exec.agent?.session,
        expect.objectContaining({
          file_path: '/paper.pdf',
          focus: 'toc',
        }),
        exec.signal,
        undefined,
      )

      await readTool.execute({ file_path: '/paper.pdf', focus: 'artifacts' }, exec)
      expect(mockService.parseDocument).toHaveBeenCalledWith(
        exec.agent?.session,
        expect.objectContaining({
          file_path: '/paper.pdf',
          focus: 'artifacts',
        }),
        exec.signal,
        undefined,
      )
    })

    it('does not inline images when focus does not include image modality', async () => {
      const mockAttachments = {
        saveImage: vi.fn(async () => ({
          attachmentId: 'att_img_1',
          mediaType: 'image/png',
          name: 'fig1.png',
          width: 100,
          height: 100,
          bytes: 50,
        })),
      }
      const mockLlm = {
        resolveModelInfo: vi.fn(async () => ({ inputModalities: ['text', 'image'] })),
      }
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
          if (name === 'attachments') return mockAttachments
          if (name === 'llm') return mockLlm
          return undefined
        }),
        effect: vi.fn(),
        on: vi.fn(),
        inject: vi.fn(),
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      } as unknown as Context

      const mockService = {
        parseDocument: vi.fn(async () => ({
          state: 'completed' as const,
          source: 'cache' as const,
          cache_hit: true,
          result_id: 'mr_1',
          files: [{
            file_id: 'mf_1',
            name: 'doc.pdf',
            artifacts: [{ kind: 'images', path: '/fake/img.png', bytes: 100 }],
          }],
          content_status: 'complete' as const,
          manifest_path: '/cache/m.json',
          output_limit_chars: 1000,
          ordered_images: [],
        })),
      } as unknown as MinerUService

      registerTools(ctx, () => mockService)
      const readTool = registeredTools.find(t => t.name === 'read_pdf')!
      const exec: ToolRunContext = {
        callId: 'call_1',
        name: 'read_pdf',
        arguments: {},
        signal: new AbortController().signal,
        agent: {
          id: 'agent_1',
          options: { provider: 'test-p', model: 'test-m' },
          session: {
            id: 'sess_1',
            header: { id: 'sess_1', cwd: '/work' },
          },
        } as any,
      }

      // 1. focus: 'toc' should NOT inline images
      const tocRes = await readTool.execute({ file_path: '/paper.pdf', focus: 'toc' }, exec) as ResultView
      expect(mockAttachments.saveImage).not.toHaveBeenCalled()
      expect(tocRes.inlined_images).toBeUndefined()
      expect(renderResult(tocRes)).toHaveLength(1)

      // 2. focus: 'text' should NOT inline images
      const textRes = await readTool.execute({ file_path: '/paper.pdf', focus: 'text' }, exec) as ResultView
      expect(mockAttachments.saveImage).not.toHaveBeenCalled()
      expect(textRes.inlined_images).toBeUndefined()

      // 3. focus: 'table' should NOT inline images
      const tableRes = await readTool.execute({ file_path: '/paper.pdf', focus: 'table' }, exec) as ResultView
      expect(mockAttachments.saveImage).not.toHaveBeenCalled()
      expect(tableRes.inlined_images).toBeUndefined()

      // 3b. focus: 'artifacts' should NOT inline images
      const artifactsRes = await readTool.execute({ file_path: '/paper.pdf', focus: 'artifacts' }, exec) as ResultView
      expect(mockAttachments.saveImage).not.toHaveBeenCalled()
      expect(artifactsRes.inlined_images).toBeUndefined()

      // 4. focus: ['toc', 'text'] should NOT inline images
      const multiRes = await readTool.execute({ file_path: '/paper.pdf', focus: ['toc', 'text'] }, exec) as ResultView
      expect(mockAttachments.saveImage).not.toHaveBeenCalled()
      expect(multiRes.inlined_images).toBeUndefined()

      // 5. focus: 'all' when ordered_images is empty should NOT fallback to all document images
      const allEmptyRes = await readTool.execute({ file_path: '/paper.pdf', focus: 'all' }, exec) as ResultView
      expect(mockAttachments.saveImage).not.toHaveBeenCalled()
      expect(allEmptyRes.inlined_images).toBeUndefined()

      // 6. focus: 'image' when ordered_images has an image should inline it
      const testImgPath = join(tmpdir(), 'test-inline-fig.png')
      await writeFile(testImgPath, Buffer.from('fake-png-data'))
      try {
        const mockServiceWithImages = {
          parseDocument: vi.fn(async () => ({
            state: 'completed' as const,
            source: 'cache' as const,
            cache_hit: true,
            result_id: 'mr_2',
            files: [{
              file_id: 'mf_1',
              name: 'doc.pdf',
              artifacts: [],
            }],
            content_status: 'complete' as const,
            manifest_path: '/cache/m.json',
            output_limit_chars: 1000,
            ordered_images: [{
              path: testImgPath,
              name: 'test-inline-fig.png',
              page: 1,
              media_type: 'image/png',
              bytes: 13,
            }],
          })),
        } as unknown as MinerUService
        const { ctx: ctx2, registeredTools: tools2 } = createMockContext()
        ;(ctx2.get as any) = vi.fn((name: string) => {
          if (name === 'attachments') return mockAttachments
          if (name === 'llm') return mockLlm
          return undefined
        })
        registerTools(ctx2, () => mockServiceWithImages)
        const readTool2 = tools2.find(t => t.name === 'read_pdf')!

        const imageRes = await readTool2.execute({ file_path: '/paper.pdf', focus: 'image' }, exec) as ResultView
        expect(mockAttachments.saveImage).toHaveBeenCalledTimes(1)
        expect(imageRes.inlined_images).toHaveLength(1)
        expect(imageRes.inlined_images![0]?.name).toBe('fig1.png')
        expect(renderResult(imageRes)).toHaveLength(2)
      } finally {
        await rm(testImgPath, { force: true })
      }
    })

    it.each([
      { copies: 1, bytes: 25 * 1024 * 1024, attached: 0 },
      { copies: 4, bytes: 8 * 1024 * 1024, attached: 3 },
    ])('limits normalized growth for $copies images independently of source bytes', async ({ copies, bytes, attached }) => {
      const path = join(tmpdir(), 'mineru-normalized-growth.png')
      await writeFile(path, Buffer.from('fake-png-data'))
      try {
        const saveImage = vi.fn(async () => ({ attachmentId: 'att_growth', mediaType: 'image/png', name: 'growth.png', bytes }))
        const service = { parseDocument: vi.fn(async () => ({ state: 'completed' as const, source: 'provider' as const, cache_hit: false, result_id: 'mr_growth', files: [{ file_id: 'mf_1', name: 'doc.pdf', artifacts: [] }], content_status: 'complete' as const, manifest_path: '/cache/m.json', output_limit_chars: 20_000, ordered_images: Array.from({ length: copies }, () => ({ path, name: 'growth.png', media_type: 'image/png', bytes: 13 })) })) } as unknown as MinerUService
        const { ctx, registeredTools } = createMockContext()
        ;(ctx.get as any) = vi.fn((name: string) => name === 'attachments' ? { saveImage } : name === 'llm' ? { resolveModelInfo: vi.fn(async () => ({ inputModalities: ['text', 'image'] })) } : undefined)
        registerTools(ctx, () => service)
        const exec = createMockExec()
        ;(exec.agent as any).options = { provider: 'test-p', model: 'test-m' }
        const value = await registeredTools.find(item => item.name === 'read_pdf')!.execute({ file_path: '/paper.pdf', focus: 'image' }, exec) as ResultView
        expect(value.inlined_images?.length ?? 0).toBe(attached)
        expect(value.ordered_images?.at(-1)?.status).toBe('omitted')
        expect(saveImage).toHaveBeenCalledTimes(copies)
      } finally { await rm(path, { force: true }) }
    })

    it('applies the live inline image budget and snapshots it per invocation', async () => {
      const path = join(tmpdir(), 'mineru-configured-inline-budget.png')
      await writeFile(path, Buffer.from('fake-png-data'))
      try {
        let maxInlineImages = 2
        const saveImage = vi.fn(async () => ({ attachmentId: 'att_budget', mediaType: 'image/png', name: 'budget.png', bytes: 13 }))
        const view = {
          state: 'completed' as const,
          source: 'provider' as const,
          cache_hit: false,
          result_id: 'mr_budget',
          files: [{ file_id: 'mf_1', name: 'doc.pdf', artifacts: [] }],
          content_status: 'complete' as const,
          manifest_path: '/cache/m.json',
          output_limit_chars: 20_000,
          ordered_images: Array.from({ length: 8 }, (_, index) => ({
            path,
            name: `figure-${String(index + 1)}.png`,
            media_type: 'image/png' as const,
            bytes: 13,
          })),
        }
        const service = {
          parseDocument: vi.fn(async () => {
            maxInlineImages = 8
            return view
          }),
        } as unknown as MinerUService
        const { ctx, registeredTools } = createMockContext()
        ;(ctx.get as any) = vi.fn((name: string) => name === 'attachments'
          ? { saveImage }
          : name === 'llm' ? { resolveModelInfo: vi.fn(async () => ({ inputModalities: ['text', 'image'] })) } : undefined)
        registerTools(ctx, () => service, undefined, () => ({ maxInlineChars: 20_000, maxInlineImages }))
        const exec = createMockExec()
        ;(exec.agent as any).options = { provider: 'test-p', model: 'test-m' }
        const tool = registeredTools.find(item => item.name === 'read_pdf')!

        const first = await tool.execute({ file_path: '/paper.pdf', focus: 'image' }, exec) as ResultView
        expect(first.inlined_images).toHaveLength(2)
        expect(first.ordered_images?.map(item => item.status)).toEqual([
          'available', 'available', 'omitted', 'omitted', 'omitted', 'omitted', 'omitted', 'omitted',
        ])

        const second = await tool.execute({ file_path: '/paper.pdf', focus: 'image' }, exec) as ResultView
        expect(second.inlined_images).toHaveLength(8)
        expect(saveImage).toHaveBeenCalledTimes(10)
      } finally { await rm(path, { force: true }) }
    })

    it('omits normalized images with missing or invalid emitted byte counts', async () => {
      const paths = [1, 2].map(index => join(tmpdir(), 'mineru-invalid-bytes-' + String(index) + '.png'))
      await Promise.all(paths.map(path => writeFile(path, Buffer.from('fake-png-data'))))
      try {
        const saveImage = vi.fn()
          .mockResolvedValueOnce({ attachmentId: 'att_missing', mediaType: 'image/png', name: 'missing.png' })
          .mockResolvedValueOnce({ attachmentId: 'att_invalid', mediaType: 'image/png', name: 'invalid.png', bytes: '13' })
        const service = { parseDocument: vi.fn(async () => ({ state: 'completed' as const, source: 'provider' as const, cache_hit: false, result_id: 'mr_invalid_bytes', files: [{ file_id: 'mf_1', name: 'doc.pdf', artifacts: [] }], content_status: 'complete' as const, manifest_path: '/cache/m.json', output_limit_chars: 20_000, ordered_images: paths.map((path, index) => ({ path, name: 'figure-' + String(index + 1) + '.png', media_type: 'image/png', bytes: 13 })) })) } as unknown as MinerUService
        const { ctx, registeredTools } = createMockContext()
        ;(ctx.get as any) = vi.fn((name: string) => name === 'attachments' ? { saveImage } : name === 'llm' ? { resolveModelInfo: vi.fn(async () => ({ inputModalities: ['text', 'image'] })) } : undefined)
        registerTools(ctx, () => service)
        const exec = createMockExec()
        ;(exec.agent as any).options = { provider: 'test-p', model: 'test-m' }
        const value = await registeredTools.find(item => item.name === 'read_pdf')!.execute({ file_path: '/paper.pdf', focus: 'image' }, exec) as ResultView
        expect(value.inlined_images).toBeUndefined()
        expect(value.ordered_images?.map(item => item.status)).toEqual(['omitted', 'omitted'])
      } finally { await Promise.all(paths.map(path => rm(path, { force: true }))) }
    })

    it('propagates cancellation after saving the last image', async () => {
      const path = join(tmpdir(), 'mineru-last-image-abort.png')
      await writeFile(path, Buffer.from('fake-png-data'))
      try {
        const controller = new AbortController()
        const saveImage = vi.fn(async () => { controller.abort(); return { attachmentId: 'att_last', mediaType: 'image/png', name: 'last.png', bytes: 13 } })
        const service = { parseDocument: vi.fn(async () => ({ state: 'completed' as const, source: 'provider' as const, cache_hit: false, result_id: 'mr_last_abort', files: [{ file_id: 'mf_1', name: 'doc.pdf', artifacts: [] }], content_status: 'complete' as const, manifest_path: '/cache/m.json', output_limit_chars: 20_000, ordered_images: [{ path, name: 'last.png', media_type: 'image/png', bytes: 13 }] })) } as unknown as MinerUService
        const { ctx, registeredTools } = createMockContext()
        ;(ctx.get as any) = vi.fn((name: string) => name === 'attachments' ? { saveImage } : name === 'llm' ? { resolveModelInfo: vi.fn(async () => ({ inputModalities: ['text', 'image'] })) } : undefined)
        registerTools(ctx, () => service)
        const exec = createMockExec(true, controller.signal)
        ;(exec.agent as any).options = { provider: 'test-p', model: 'test-m' }
        await expect(registeredTools.find(item => item.name === 'read_pdf')!.execute({ file_path: '/paper.pdf', focus: 'image' }, exec)).rejects.toThrow()
      } finally { await rm(path, { force: true }) }
    })

    it('reports failed and omitted figures while preserving stable numbering', async () => {
      const paths = [1, 2, 3].map(index => join(tmpdir(), 'mineru-figure-' + String(index) + '.png'))
      await Promise.all(paths.map(path => writeFile(path, Buffer.from('fake-png-data'))))
      try {
        const saveImage = vi.fn()
          .mockResolvedValueOnce({ attachmentId: 'att_1', mediaType: 'image/png', name: 'one.png', bytes: 13 })
          .mockRejectedValueOnce(new Error('save failed'))
          .mockResolvedValueOnce({ attachmentId: 'att_3', mediaType: 'image/png', name: 'three.png', bytes: 25 * 1024 * 1024 })
        const service = { parseDocument: vi.fn(async () => ({ state: 'completed' as const, source: 'provider' as const, cache_hit: false, result_id: 'mr_figures', files: [{ file_id: 'mf_1', name: 'doc.pdf', artifacts: [] }], content_status: 'complete' as const, manifest_path: '/cache/m.json', output_limit_chars: 20_000, ordered_images: paths.map((path, index) => ({ path, name: 'figure-' + String(index + 1) + '.png', media_type: 'image/png', bytes: 13, page: index + 1 })) })) } as unknown as MinerUService
        const { ctx, registeredTools } = createMockContext()
        ;(ctx.get as any) = vi.fn((name: string) => name === 'attachments' ? { saveImage } : name === 'llm' ? { resolveModelInfo: vi.fn(async () => ({ inputModalities: ['text', 'image'] })) } : undefined)
        registerTools(ctx, () => service)
        const tool = registeredTools.find(value => value.name === 'read_pdf')!
        const exec = createMockExec()
        ;(exec.agent as any).options = { provider: 'test-p', model: 'test-m' }
        const value = await tool.execute({ file_path: '/paper.pdf', focus: 'image' }, exec) as ResultView
        expect(value.inlined_images).toHaveLength(1)
        expect(value.inlined_images![0]?.figure).toBe(1)
        expect(value.ordered_images?.map(image => image.status)).toEqual(['available', 'failed', 'omitted'])
        const text = (renderResult(value)[0] as any).text as string
        expect(text).toContain('Figure 2 (Page 2)')
        expect(text).toContain('[failed]')
        expect(text).toContain('[omitted]')
      } finally {
        await Promise.all(paths.map(path => rm(path, { force: true })))
      }
    })

    it('formats extracted image paths for non-multimodal models when images are requested', async () => {
      const exec = createMockExec(true)
      const mockLlmTextOnly = {
        resolveModelInfo: vi.fn(async () => ({ inputModalities: ['text'] })),
      }
      const testImgPath = join(tmpdir(), 'test-textonly-fig.png')
      await writeFile(testImgPath, Buffer.from('fake-png-data'))
      try {
        const mockServiceWithImages = {
          parseDocument: vi.fn(async () => ({
            state: 'completed' as const,
            source: 'cache' as const,
            cache_hit: true,
            result_id: 'mr_textonly',
            files: [{
              file_id: 'mf_1',
              name: 'doc.pdf',
              artifacts: [],
            }],
            markdown_content: '# Document with Figures\n> 🖼️ **[Attached Image #1]** Page 1: Diagram',
            content_status: 'complete' as const,
            manifest_path: '/cache/m.json',
            output_limit_chars: 1000,
            ordered_images: [{
              path: testImgPath,
              name: 'test-textonly-fig.png',
              page: 1,
              caption: 'Diagram',
              media_type: 'image/png',
              bytes: 13,
            }],
          })),
        } as unknown as MinerUService
        const { ctx, registeredTools } = createMockContext()
        ;(ctx.get as any) = vi.fn((name: string) => {
          if (name === 'llm') return mockLlmTextOnly
          return undefined
        })
        registerTools(ctx, () => mockServiceWithImages)
        const readTool = registeredTools.find(t => t.name === 'read_pdf')!

        const res = await readTool.execute({ file_path: '/paper.pdf', focus: 'image' }, exec) as ResultView
        expect(res.inlined_images).toBeUndefined()
        expect(res.ordered_images).toHaveLength(1)

        const rendered = readTool.output.render({ file_path: '/paper.pdf', focus: 'image' }, res)
        expect(rendered).toHaveLength(1)
        expect(rendered[0]?.text).not.toContain('**Extracted Images**:')
        expect(rendered[0]?.text).toContain(`Figure 1 (Page 1, "Diagram"): ${testImgPath}`)
        expect(rendered[0]?.text).not.toContain('manifest.json')
      } finally {
        await rm(testImgPath, { force: true })
      }
    })

    it('projects structured presentation metadata for single result', () => {
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
        content_status: 'complete',
        output_limit_chars: 2000,
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
    })

    it('rejects invalid poll timeouts before invoking the service', async () => {
      const mockService = { parseDocument: vi.fn() } as unknown as MinerUService
      const { ctx, registeredTools } = createMockContext()
      registerTools(ctx, () => mockService)
      const parseTool = registeredTools.find(t => t.name === 'read_pdf')!
      const exec = createMockExec(true)

      for (const poll_timeout_ms of [-1, 0, 86_400_001, Number.MAX_SAFE_INTEGER, 1.5, NaN]) {
        await expect(parseTool.execute({ file_path: '/doc.pdf', poll_timeout_ms }, exec))
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
      expect(rendered[0]?.text).not.toContain('read_offset_line')
      expect(rendered[0]?.text).not.toContain('Manifest:')
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
      expect(rendered[0]?.text).toContain('Status: Content complete. Full requested document markdown delivered above.')
      expect(rendered[0]?.text).not.toContain('/cache/doc/manifest.json')
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
      expect(rendered[0]?.text).not.toContain('Manifest:')
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
        manifest_path: '/cache/doc/manifest.json',
        output_limit_chars: 2000,
      }
      const rendered = renderResult(resultData)
      expect(rendered[0]?.text).toContain('Status: Content partial (truncated to output limit)')
      expect(rendered[0]?.text).toContain('Full markdown artifact available in local result storage.')
      expect(rendered[0]?.text).not.toContain('Manifest:')
    })

    it('renders extracted image file paths for non-multimodal model when images are present', () => {
      const resultData: ResultView = {
        state: 'completed',
        source: 'provider',
        cache_hit: false,
        result_id: 'mr_img_paths',
        files: [{
          file_id: 'mf_1',
          name: 'doc.pdf',
          artifacts: [{ kind: 'markdown', path: '/cache/doc/full.md', bytes: 500 }],
        }],
        markdown_content: '# Document with Figures\n> 🖼️ **[Attached Image #1]** Page 2: Chart',
        content_status: 'complete',
        manifest_path: '/cache/doc/manifest.json',
        output_limit_chars: 2000,
        ordered_images: [
          { path: '/cache/doc/images/fig1.png', name: 'fig1.png', page: 2, caption: 'Chart', media_type: 'image/png', bytes: 1200 },
          { path: '/cache/doc/images/fig2.png', name: 'fig2.png', page: 3, media_type: 'image/png', bytes: 3400 },
        ],
      }
      const rendered = renderResult(resultData)
      expect(rendered).toHaveLength(1)
      expect(rendered[0]?.text).not.toContain('**Extracted Images**:')
      expect(rendered[0]?.text).toContain('Figure 1 (Page 2, "Chart"): /cache/doc/images/fig1.png')
      expect(rendered[0]?.text).toContain('Figure 2 (Page 3): /cache/doc/images/fig2.png')
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
      expect((rendered[0] as any).text).toContain('Figure 1: figure1.png (800x600)')
      expect(rendered[1]).toEqual({
        type: 'image',
        attachment: resultData.inlined_images![0]!.attachmentRef,
      })
    })

    it('reconstructs ImageAttachmentRef from InlinedImageView when attachmentRef property is omitted', () => {
      const resultData: ResultView = {
        state: 'completed',
        source: 'provider',
        cache_hit: false,
        result_id: 'mr_with_img_no_ref',
        files: [{ file_id: 'mf_1', name: 'doc.pdf', artifacts: [] }],
        markdown_content: '# Visual Doc',
        content_status: 'complete',
        manifest_path: '/cache/doc/manifest.json',
        output_limit_chars: 2000,
        inlined_images: [
          {
            attachment_id: 'att_reconstructed',
            name: 'figure2.jpg',
            media_type: 'image/jpeg',
            width: 640,
            height: 480,
            bytes: 65432,
          },
        ],
      }
      const rendered = renderResult(resultData)
      expect(rendered).toHaveLength(2)
      expect(rendered[1]).toEqual({
        type: 'image',
        attachment: {
          attachmentId: 'att_reconstructed',
          mediaType: 'image/jpeg',
          bytes: 65432,
          width: 640,
          height: 480,
          name: 'figure2.jpg',
        },
      })
    })

    it('validates tool output with inlined_images against read_pdf schema without violations', () => {
      const { ctx, registeredTools } = createMockContext()
      registerTools(ctx, () => ({} as MinerUService))
      const readTool = registeredTools.find(t => t.name === 'read_pdf')!

      const validResult: ResultView = {
        state: 'completed',
        source: 'provider',
        cache_hit: false,
        result_id: 'mr_schema_test',
        files: [{ file_id: 'mf_1', name: 'doc.pdf', artifacts: [] }],
        markdown_content: '# Test',
        content_status: 'complete',
        manifest_path: '/cache/doc/manifest.json',
        output_limit_chars: 2000,
        inlined_images: [
          {
            attachment_id: 'att_123',
            name: 'fig.png',
            media_type: 'image/png',
            width: 100,
            height: 100,
            bytes: 500,
          },
        ],
      }
      const violations = validateJsonSchemaValue(readTool.output.schema, validResult, 'value')
      expect(violations).toEqual([])

      const invalidResultWithAttachmentRef = {
        ...validResult,
        inlined_images: [
          {
            ...validResult.inlined_images![0],
            attachmentRef: { some: 'ref' },
          },
        ],
      }
      const invalidViolations = validateJsonSchemaValue(readTool.output.schema, invalidResultWithAttachmentRef, 'value')
      expect(invalidViolations).toContain('"value.inlined_images[0].attachmentRef" is not a declared property (additionalProperties: false)')
    })

    it('rejects an empty nested result file object', () => {
      const { ctx, registeredTools } = createMockContext()
      registerTools(ctx, () => ({} as MinerUService))
      const readTool = registeredTools.find(t => t.name === 'read_pdf')!
      const fileSchema = (readTool.output.schema as any).properties.files.items
      expect(fileSchema.properties.file_id.required).toBe(true)
      expect(fileSchema.properties.name.required).toBe(true)
      expect(fileSchema.properties.artifacts.required).toBe(true)
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
      expect(text).not.toContain('starting from the given line offset')
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
      expect(text).toContain('Status: Content complete. Full requested document markdown delivered above.')
    })
  })

  describe('lossless JSON compliance', () => {
    it('returns strictly lossless JSON when optional fields (pages, etc.) are omitted', async () => {
      const { ctx, registeredTools } = createMockContext()
      const mockResult: ResultView = {
        state: 'completed',
        source: 'cache',
        cache_hit: true,
        result_id: 'mr_lossless_test',
        files: [{ file_id: 'mf_1', name: 'doc.pdf', artifacts: [] }],
        markdown_content: 'sample content',
        content_status: 'complete',
        manifest_path: '/cache/doc/manifest.json',
        output_limit_chars: 2000,
        summary: {
          table_count: 0,
          image_count: 0,
          equation_count: 0,
        },
      }
      registerTools(ctx, () => ({
        parseDocument: vi.fn(async () => mockResult),
      } as unknown as MinerUService))
      const readTool = registeredTools.find(t => t.name === 'read_pdf')!
      const exec = createMockExec(true)
      const res = await readTool.execute({ file_path: '/doc.pdf' }, exec)

      expect(isJsonValue(res)).toBe(true)
      expect(snapshotJsonValue(res)).toBeDefined()
      expect('pages' in (res as Record<string, unknown>)).toBe(false)
    })
  })
})
