import { describe, expect, it, vi } from 'vitest'
import { AttachmentId, type FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { createUserMessage, ToolCallId, type ContentBlock } from '@deepseek-ai/dsh-llm'
import { parseDocumentSource, resolveDocumentPath } from '../src/adapters/dsh-document-source.js'
import { parseAsyncInput, parseReadInput } from '../src/tools.js'

const first: FileAttachmentRef = { attachmentId: AttachmentId('sha256:12345678' + 'a'.repeat(56)), name: 'paper.pdf', bytes: 42 }
const second: FileAttachmentRef = { attachmentId: AttachmentId('sha256:12345678' + 'b'.repeat(56)), name: 'other.pdf', bytes: 43 }
const file = (attachment: FileAttachmentRef): ContentBlock => ({ type: 'file', attachment })
const nested = (content: ContentBlock[]): ContentBlock => ({ type: 'tool-result', toolCallId: ToolCallId('nested'), content, isError: false })
const session = (...content: ContentBlock[]) => ({ deriveMessages: () => [createUserMessage({ content, source: { kind: 'user' } })] })

describe('DSH attachment source adapter', () => {
  it.each([String(first.attachmentId), String(first.attachmentId).slice(7), 'sha256:12345678', '12345678', '12345678A'])('resolves %s from structured visible file references', selector => {
    const messages = session(nested([nested([file(first)])])).deriveMessages()
    const visibleRef = messages[0]!.content[0]!
    const fileHostPath = vi.fn(() => '/dsh-owned/paper.pdf')
    expect(resolveDocumentPath(parseDocumentSource({ attachment_id: selector }), { deriveMessages: () => messages }, { fileHostPath })).toBe('/dsh-owned/paper.pdf')
    expect(fileHostPath).toHaveBeenCalledOnce()
    expect(fileHostPath.mock.calls[0]![0]).toEqual(first)
    // The upstream reference object itself is handed off, not reconstructed.
    if (visibleRef.type !== 'tool-result' || visibleRef.content[0]?.type !== 'tool-result' || visibleRef.content[0].content[0]?.type !== 'file') throw new Error('bad fixture')
    expect(fileHostPath.mock.calls[0]![0]).toBe(visibleRef.content[0].content[0].attachment)
  })

  it('deduplicates repeated and renamed references by content ID', () => {
    const fileHostPath = vi.fn(() => '/dsh-owned/paper.pdf')
    expect(resolveDocumentPath({ attachment_id: '12345678' }, session(file(first), nested([file(first), file({ ...first, name: 'renamed.pdf' })])), { fileHostPath })).toBe('/dsh-owned/paper.pdf')
    expect(fileHostPath).toHaveBeenCalledOnce()
  })

  it('rejects ambiguous prefixes but permits full IDs and longer unique prefixes', () => {
    const visible = session(file(first), file(second))
    const fileHostPath = vi.fn(() => '/dsh-owned/paper.pdf')
    expect(() => resolveDocumentPath({ attachment_id: '12345678' }, visible, { fileHostPath })).toThrow(/ambiguous/)
    expect(fileHostPath).not.toHaveBeenCalled()
    for (const attachment_id of [String(first.attachmentId), '12345678a']) {
      expect(resolveDocumentPath({ attachment_id }, visible, { fileHostPath })).toBe('/dsh-owned/paper.pdf')
    }
  })

  it('does not treat plain text, image refs or absent/compacted refs as file references', () => {
    const fileHostPath = vi.fn()
    const visible = session({ type: 'text', text: JSON.stringify(first) }, { type: 'image', attachment: { attachmentId: first.attachmentId, mediaType: 'image/png', bytes: 42, width: 1, height: 1 } })
    expect(() => resolveDocumentPath({ attachment_id: '12345678' }, visible, { fileHostPath })).toThrow(/No file attachment/)
    expect(fileHostPath).not.toHaveBeenCalled()
  })

  it('reads the current surface afresh rather than caching previous references', () => {
    const deriveMessages = vi.fn().mockReturnValueOnce(session(file(first)).deriveMessages()).mockReturnValueOnce([])
    const store = { fileHostPath: vi.fn(() => '/dsh-owned/paper.pdf') }
    expect(resolveDocumentPath({ attachment_id: '12345678' }, { deriveMessages }, store)).toBe('/dsh-owned/paper.pdf')
    expect(() => resolveDocumentPath({ attachment_id: '12345678' }, { deriveMessages }, store)).toThrow(/No file attachment/)
    expect(store.fileHostPath).toHaveBeenCalledOnce()
  })

  it.each([undefined, { fileHostPath: () => undefined }])('reports unavailable host path capability', store => {
    expect(() => resolveDocumentPath({ attachment_id: '12345678' }, session(file(first)), store)).toThrow(expect.objectContaining({ failure: expect.objectContaining({ code: 'UNSUPPORTED_OPTION' }) }))
  })

  it('leaves paths alone without consulting the session or attachment store', () => {
    const deriveMessages = vi.fn(() => { throw new Error('must not inspect session') })
    const fileHostPath = vi.fn(() => { throw new Error('must not inspect store') })
    expect(resolveDocumentPath(parseDocumentSource({ file_path: '  relative.pdf  ' }), { deriveMessages }, { fileHostPath })).toBe('relative.pdf')
    expect(deriveMessages).not.toHaveBeenCalled()
    expect(fileHostPath).not.toHaveBeenCalled()
  })

  it.each([{}, { file_path: 'a.pdf', attachment_id: '12345678' }, { file_path: '' }, { file_path: null }, { attachment_id: null }, { attachment_id: '' }, { attachment_id: '1234567' }, { attachment_id: 'a'.repeat(65) }, { attachment_id: 'sha256:zzzzzzzz' }, { attachment_id: '/tmp/file.pdf' }, { attachment_id: 12345678 }])('rejects invalid source selection %j in both tools', args => {
    for (const parse of [parseReadInput, parseAsyncInput]) expect(() => parse(args)).toThrow(expect.objectContaining({ failure: expect.objectContaining({ code: 'INVALID_REQUEST' }) }))
  })
})
