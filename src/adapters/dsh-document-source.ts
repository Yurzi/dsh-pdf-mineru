import type { AttachmentStore, FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import { MinerUError, failure } from '../domain/errors.js'

/** Tool-only selectors. Attachment identities never enter the MinerU domain. */
export type DocumentSource =
  | { readonly file_path: string; readonly attachment_id?: never }
  | { readonly attachment_id: string; readonly file_path?: never }

export function parseDocumentSource(args: Readonly<Record<string, unknown>>): DocumentSource {
  if ((args.file_path !== undefined) === (args.attachment_id !== undefined)) {
    throw new MinerUError(failure('INVALID_REQUEST', 'Exactly one of file_path or attachment_id is required'))
  }
  if (args.file_path !== undefined) {
    if (typeof args.file_path !== 'string' || args.file_path.trim() === '') {
      throw new MinerUError(failure('INVALID_REQUEST', 'file_path must be a non-empty string'))
    }
    return { file_path: args.file_path.trim() }
  }
  if (typeof args.attachment_id !== 'string' || !/^(?:sha256:)?[a-fA-F0-9]{8,64}$/.test(args.attachment_id.trim())) {
    throw new MinerUError(failure('INVALID_REQUEST', 'attachment_id must be a SHA-256 digest or an unambiguous prefix of 8–64 hexadecimal characters, optionally prefixed with sha256:'))
  }
  return { attachment_id: args.attachment_id.trim().toLowerCase() }
}

function* fileReferences(blocks: readonly ContentBlock[]): Generator<FileAttachmentRef> {
  for (const block of blocks) {
    if (block.type === 'file') yield block.attachment
  }
}

/** DSH 0.1.7 exposes tool results as tool-role messages with flat content.
 * Resolve only that current surface; never scan raw history or storage. */
export function resolveDocumentPath(
  source: DocumentSource,
  session: { deriveMessages(): readonly Message[] },
  attachments: Pick<AttachmentStore, 'fileHostPath'> | undefined,
): string {
  if (source.file_path !== undefined) return source.file_path
  if (attachments === undefined) {
    throw new MinerUError(failure('UNSUPPORTED_OPTION', 'Attachment input requires the DSH attachment service; use file_path instead'))
  }
  const prefix = source.attachment_id.replace(/^sha256:/, '')
  const matches = new Map<string, FileAttachmentRef>()
  for (const message of session.deriveMessages()) {
    for (const ref of fileReferences(message.content)) {
      const id = String(ref.attachmentId)
      if (id.slice('sha256:'.length).startsWith(prefix) && !matches.has(id)) matches.set(id, ref)
    }
  }
  if (matches.size === 0) {
    throw new MinerUError(failure('INVALID_REQUEST', 'No file attachment matches attachment_id on the current session surface'))
  }
  if (matches.size > 1) {
    throw new MinerUError(failure('INVALID_REQUEST', 'attachment_id is ambiguous; use a longer prefix or the full SHA-256 ID'))
  }
  const ref = matches.values().next().value!
  const path = attachments.fileHostPath(ref)
  if (path === undefined) {
    throw new MinerUError(failure('UNSUPPORTED_OPTION', 'The DSH attachment backend does not provide a host file path; use file_path instead'))
  }
  return path
}
