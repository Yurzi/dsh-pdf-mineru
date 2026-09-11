import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from 'cordis'
import { jsonSchemaToTs, ToolArgsError, validateJsonSchemaValue, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { registerTools } from '../src/tools.js'

// Deliberately use the real defineTool compiler, unlike the execution mocks.
const disposers: Array<() => Promise<void>> = []
afterEach(async () => { await Promise.all(disposers.splice(0).map(dispose => dispose())) })

function definitions(): Map<string, ToolDefinition> {
  const registered = new Map<string, ToolDefinition>()
  const ctx = {
    tools: {
      register(definition: ToolDefinition) { registered.set(definition.name, definition); return () => undefined },
      schemas: () => [],
    },
    get: () => undefined,
  } as unknown as Context
  disposers.push(registerTools(ctx, () => { throw new Error('Schema checks must not execute a provider') }))
  return registered
}

describe('real DSH schema compilation', () => {
  it.each(['read_pdf', 'async_parse_pdf'])('%s requires file_path before entering its body', async name => {
    const tool = definitions().get(name)!
    expect(tool.parameters.required).toContain('file_path')
    const exec: ToolRunContext = { callId: 'schema-check', name, arguments: {}, signal: new AbortController().signal }
    await expect(tool.execute({}, exec)).rejects.toBeInstanceOf(ToolArgsError)
  })

  it('declares cursor as optional and rejects empty successful output values', () => {
    const tool = definitions().get('read_pdf')!
    expect(tool.parameters.properties?.cursor).toMatchObject({ type: 'string' })
    expect(tool.parameters.required).not.toContain('cursor')
    expect(validateJsonSchemaValue(tool.output.schema, {}, 'value').length).toBeGreaterThan(0)
  })

  it.each([
    ['complete', null],
    ['not_requested', null],
    ['partial', 'opaque-token'],
  ] as const)('requires an explicit nullable output cursor for %s', (content_status, cursor) => {
    const tool = definitions().get('read_pdf')!
    const value = {
      state: 'completed', source: 'cache', cache_hit: true, result_id: 'mr_fixture',
      files: [], content_status, cursor, manifest_path: '/cache/manifest.json', output_limit_chars: 2000,
    }
    expect(tool.output.schema.required).toContain('cursor')
    expect(validateJsonSchemaValue(tool.output.schema, value, 'value')).toEqual([])
    const { cursor: _cursor, ...missingCursor } = value
    expect(validateJsonSchemaValue(tool.output.schema, missingCursor, 'value').length).toBeGreaterThan(0)
    expect(validateJsonSchemaValue(tool.output.schema, { ...value, cursor: 123 }, 'value').length).toBeGreaterThan(0)
  })

  it('generates a required string-or-null cursor in the model-facing output type', () => {
    const tool = definitions().get('read_pdf')!
    const outputType = jsonSchemaToTs(tool.output.schema)
    expect(outputType).toMatch(/cursor: string \| null/)
    expect(outputType).not.toContain('cursor?:')
    expect(jsonSchemaToTs(tool.parameters)).toContain('cursor?: string')
  })

  it('rejects null input cursor before entering the tool body rather than restarting', async () => {
    const tool = definitions().get('read_pdf')!
    const args = { file_path: '/source.pdf', cursor: null }
    const exec: ToolRunContext = { callId: 'schema-check', name: 'read_pdf', arguments: args, signal: new AbortController().signal }
    await expect(tool.execute(args, exec)).rejects.toBeInstanceOf(ToolArgsError)
  })

  it('enforces the immediate native background job contract', () => {
    const tool = definitions().get('async_parse_pdf')!
    expect(validateJsonSchemaValue(tool.output.schema, { job_id: 'mineru-1', state: 'running' }, 'value')).toEqual([])
    expect(validateJsonSchemaValue(tool.output.schema, { state: 'running' }, 'value').length).toBeGreaterThan(0)
    expect(validateJsonSchemaValue(tool.output.schema, { job_id: 'mineru-1', state: 'running', task_id: 'remote-task' }, 'value').length).toBeGreaterThan(0)
  })

  it('keeps plugin-authored model schemas in English', () => {
    for (const tool of definitions().values()) {
      expect(JSON.stringify({ description: tool.description, parameters: tool.parameters })).not.toMatch(/[\u3400-\u9fff]/u)
    }
  })
})
