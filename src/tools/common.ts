import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { AttachmentStore, FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-working-directory'
import { MinerUError, failure } from '../domain/errors.js'

export type ToolAgent = NonNullable<ToolRunContext['agent']>

export function invalidRequest(message: string, cause?: unknown): MinerUError {
  return new MinerUError(failure('INVALID_REQUEST', message), cause === undefined ? undefined : { cause })
}

export function requireAgent(exec: ToolRunContext): ToolAgent {
  const agent = exec.agent
  if (agent === undefined || agent.session == null) {
    throw new MinerUError(failure('UNAUTHENTICATED_SESSION', 'MinerU operations require an authenticated agent session (UNAUTHENTICATED_SESSION)'))
  }
  return agent
}

export function argumentRecord(args: unknown, allowed: ReadonlySet<string>): Record<string, unknown> {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) throw invalidRequest('Tool arguments must be an object')
  const record = args as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw invalidRequest(`Unsupported parameter: ${key}. Valid parameters: ${[...allowed].join(', ')}`)
  }
  return record
}

/** Tool-only selectors. Attachment identities never enter the MinerU domain. */
export type DocumentSource =
  | { readonly file_path: string; readonly attachment_id?: never }
  | { readonly attachment_id: string; readonly file_path?: never }

export function parseDocumentSource(args: Readonly<Record<string, unknown>>): DocumentSource {
  if ((args.file_path !== undefined) === (args.attachment_id !== undefined)) {
    throw invalidRequest('Exactly one of file_path or attachment_id is required')
  }
  if (args.file_path !== undefined) {
    if (typeof args.file_path !== 'string' || args.file_path.trim() === '') {
      throw invalidRequest('file_path must be a non-empty string')
    }
    return { file_path: args.file_path.trim() }
  }
  if (typeof args.attachment_id !== 'string' || !/^(?:sha256:)?[a-fA-F0-9]{8,64}$/.test(args.attachment_id.trim())) {
    throw invalidRequest('attachment_id must be a SHA-256 digest or an unambiguous prefix of 8–64 hexadecimal characters, optionally prefixed with sha256:')
  }
  return { attachment_id: args.attachment_id.trim().toLowerCase() }
}

function* fileReferences(blocks: readonly ContentBlock[]): Generator<FileAttachmentRef> {
  for (const block of blocks) {
    if (block.type === 'file') yield block.attachment
  }
}

/** Resolve a visible session file reference to its host path; never scan raw history or storage. */
export function resolveAttachmentPath(
  attachmentId: string,
  session: { deriveMessages(): readonly Message[] },
  attachments: Pick<AttachmentStore, 'fileHostPath'> | undefined,
): string {
  if (attachments === undefined) {
    throw new MinerUError(failure('UNSUPPORTED_OPTION', 'Attachment input requires the DSH attachment service; use file_path instead'))
  }
  const prefix = attachmentId.replace(/^sha256:/, '')
  const matches = new Map<string, FileAttachmentRef>()
  for (const message of session.deriveMessages()) {
    for (const ref of fileReferences(message.content)) {
      const id = String(ref.attachmentId)
      if (id.slice('sha256:'.length).startsWith(prefix) && !matches.has(id)) matches.set(id, ref)
    }
  }
  if (matches.size === 0) {
    throw invalidRequest('No file attachment matches attachment_id on the current session surface')
  }
  if (matches.size > 1) {
    throw invalidRequest('attachment_id is ambiguous; use a longer prefix or the full SHA-256 ID')
  }
  const ref = matches.values().next().value!
  const path = attachments.fileHostPath(ref)
  if (path === undefined) {
    throw new MinerUError(failure('UNSUPPORTED_OPTION', 'The DSH attachment backend does not provide a host file path; use file_path instead'))
  }
  return path
}

/** Absolute source path: file paths resolve against the caller's effective working directory. */
export async function resolveSourcePath(
  source: DocumentSource,
  agent: ToolAgent,
  exec: ToolRunContext,
  ctx: Context,
  attachments: AttachmentStore | undefined,
): Promise<string> {
  if (source.file_path === undefined) return resolveAttachmentPath(source.attachment_id, agent.session, attachments)
  return resolve(await ctx.workingDirectory.ensure(agent, exec.signal), source.file_path)
}

/** Whether the calling model route accepts image input; unknown routes are text-only. */
export async function modelSupportsImages(exec: ToolRunContext, ctx: Context): Promise<boolean> {
  const routed = exec.agent?.session?.requestHeader?.()?.config
  const provider = routed?.provider ?? exec.agent?.options?.provider
  const model = routed?.model ?? exec.agent?.options?.model
  const llm = ctx.get('llm')
  if (provider && model && llm) {
    try {
      const active = await llm.resolveModelInfo(provider, model, exec.signal)
      return active?.inputModalities?.includes('image') ?? false
    } catch (error) {
      if (exec.signal.aborted) throw error
      return false
    }
  }
  return false
}
