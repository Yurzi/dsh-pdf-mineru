import { jsonSchemaToTs, renderToolsSdkPy, ToolArgsError, validateJsonSchemaValue, type JsonSchemaNode } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import { toolHarness } from './support/tool-harness.js'
import { resultView } from './support/views.js'

// The real defineTool compiler; no tool body runs except where stated.
const definitions = async () => (await toolHarness()).definitions

/** Every object node in a compiled schema, with its path. */
function* objectNodes(node: unknown, path: string): Generator<[string, Record<string, unknown>]> {
  if (node === null || typeof node !== 'object') return
  const record = node as Record<string, unknown>
  if (record.type === 'object' || (Array.isArray(record.type) && record.type.includes('object'))) yield [path, record]
  for (const [key, child] of Object.entries(record)) {
    if (key === 'properties' && child !== null && typeof child === 'object') {
      for (const [name, property] of Object.entries(child)) yield* objectNodes(property, path + '.' + name)
    } else if (key === 'items' || key === 'additionalProperties') yield* objectNodes(child, path + '[]')
  }
  for (const key of ['oneOf', 'anyOf'] as const) {
    const variants = record[key]
    if (Array.isArray(variants)) for (const [index, variant] of variants.entries()) yield* objectNodes(variant, path + '.' + key + '[' + String(index) + ']')
  }
}

describe('compiled tool schemas', () => {
  it.each(['read_pdf', 'async_parse_pdf'])('%s declares additionalProperties on every object and closes every output object', async name => {
    const tool = (await definitions()).get(name)!
    const outputs = [...objectNodes(tool.output.schema, name + '.output')]
    expect(outputs.length).toBeGreaterThan(name === 'read_pdf' ? 5 : 0)
    for (const [path, node] of outputs) expect(node.additionalProperties, path).toBe(false)
    for (const [path, node] of objectNodes(tool.parameters, name + '.parameters')) {
      if (path !== name + '.parameters') expect(node, path).toHaveProperty('additionalProperties')
    }
  })

  it.each(['read_pdf', 'async_parse_pdf'])('%s keeps both source fields optional and enforces exactly one at runtime', async name => {
    const h = await toolHarness()
    const tool = h.tool(name as 'read_pdf' | 'async_parse_pdf')
    expect(tool.parameters.required ?? []).not.toContain('file_path')
    expect(tool.parameters.required ?? []).not.toContain('attachment_id')
    expect(jsonSchemaToTs(tool.parameters as JsonSchemaNode)).toMatch(/file_path\?: string[\s\S]*attachment_id\?: string|attachment_id\?: string[\s\S]*file_path\?: string/)
    for (const args of [{}, { file_path: '/source.pdf', attachment_id: 'sha256:12345678' }]) {
      await expect(tool.execute(args, h.exec())).rejects.toMatchObject({ failure: { code: 'INVALID_REQUEST' } })
    }
  })

  it.each([['complete', null], ['not_requested', null], ['partial', 'opaque-token']] as const)(
    'requires an explicit nullable output cursor (%s)', async (content_status, cursor) => {
      const schema = (await definitions()).get('read_pdf')!.output.schema
      const value = resultView({ content_status, cursor })
      expect(validateJsonSchemaValue(schema, value, 'value')).toEqual([])
      const { cursor: _omitted, ...missing } = value
      expect(validateJsonSchemaValue(schema, missing, 'value')).not.toEqual([])
      expect(validateJsonSchemaValue(schema, { ...value, cursor: 123 }, 'value')).not.toEqual([])
      expect(validateJsonSchemaValue(schema, {}, 'value')).not.toEqual([])
    })

  it('generates a required string-or-null output cursor and an optional input cursor for PTC SDKs', async () => {
    const tools = [...(await definitions()).values()]
    const read = tools.find(tool => tool.name === 'read_pdf')!
    expect(jsonSchemaToTs(read.output.schema)).toMatch(/cursor: string \| null/)
    expect(jsonSchemaToTs(read.parameters as JsonSchemaNode)).toContain('cursor?: string')
    const sdk = renderToolsSdkPy(tools.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters, output: tool.output.schema })))
    for (const expected of ['async def read_pdf', 'async def async_parse_pdf', 'attachment_id: NotRequired[str]', 'file_path: NotRequired[str]', 'cursor: str | None']) {
      expect(sdk).toContain(expected)
    }
  })

  it('rejects a null input cursor at the schema boundary instead of restarting the read', async () => {
    const h = await toolHarness()
    await expect(h.read({ file_path: '/source.pdf', cursor: null })).rejects.toBeInstanceOf(ToolArgsError)
    expect(h.reader.readContent).not.toHaveBeenCalled()
  })

  it('accepts only the immediate native job handle as async output', async () => {
    const schema = (await definitions()).get('async_parse_pdf')!.output.schema
    expect(validateJsonSchemaValue(schema, { job_id: 'opaque-job', state: 'running' }, 'value')).toEqual([])
    expect(validateJsonSchemaValue(schema, { state: 'running' }, 'value')).not.toEqual([])
    expect(validateJsonSchemaValue(schema, { job_id: 'opaque-job', state: 'running', task_id: 'remote-task' }, 'value')).not.toEqual([])
  })
})
