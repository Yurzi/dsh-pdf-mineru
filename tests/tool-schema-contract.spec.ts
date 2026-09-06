import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from 'cordis'
import { ToolArgsError, validateJsonSchemaValue, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
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
