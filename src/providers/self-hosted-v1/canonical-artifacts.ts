import { Readable } from 'node:stream'
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web'
import { MinerUError, failure } from '../../domain/errors.js'
import type { ArtifactRef } from '../../domain/result.js'
import type { ArtifactInput, ArtifactSink, ArtifactWriteOptions } from '../../storage/artifact-port.js'

async function readArtifactInputText(input: ArtifactInput, maxBytes: number | undefined): Promise<string> {
  if (typeof input === 'string') return input
  const stream: Readable = input instanceof Uint8Array
    ? Readable.from([input])
    : input instanceof Readable
      ? input
      : Readable.fromWeb(input as NodeWebReadableStream<Uint8Array>)
  const chunks: Buffer[] = []
  let totalBytes = 0
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
      totalBytes += buffer.byteLength
      if (maxBytes !== undefined && totalBytes > maxBytes) {
        throw new MinerUError(failure('RESULT_TOO_LARGE', `Artifact input exceeded byte limit of ${String(maxBytes)} bytes`, false, { provider: 'self-hosted-v1' }))
      }
      chunks.push(buffer)
    }
  } catch (error) {
    stream.destroy()
    throw error
  }
  return Buffer.concat(chunks).toString('utf8')
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function paragraphTitleLevel(type: string | undefined, source: Record<string, unknown>): number | undefined {
  const level = source.level
  if (type !== 'doc_title' && type !== 'paragraph_title' && type !== 'title') return undefined
  return typeof level === 'number' && Number.isSafeInteger(level) && level >= 1 ? level : undefined
}

/** MinerU 4.x captions/footnotes are strings or `{ bbox, content }` objects; the canonical artifact holds strings. */
function captionStrings(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  const captions: string[] = []
  for (const item of value) {
    const text = typeof item === 'string' ? item : asRecord(item)?.content
    if (typeof text === 'string' && text.trim() !== '') captions.push(text)
  }
  return captions
}

/**
 * Converts the MinerU 4.x `structured_content.json` document into the plugin's canonical
 * content-list array: the page container supplies each block's `page_idx`, MinerU title
 * types map onto the canonical heading fields, and image/table references map onto the
 * canonical caption and image-path fields. Unknown fields are preserved as-is.
 */
export function canonicalizeStructuredContent(parsed: unknown): readonly unknown[] | undefined {
  // Already a canonical content list.
  if (Array.isArray(parsed)) return undefined
  const document = asRecord(parsed)
  const pages = document?.pages
  if (!Array.isArray(pages)) return undefined

  const blocks: unknown[] = []
  for (const page of pages) {
    const pageRecord = asRecord(page)
    if (pageRecord === undefined) continue
    const pageBlocks = pageRecord.blocks
    if (!Array.isArray(pageBlocks)) continue
    const pageIndex = pageRecord.page_idx
    for (const block of pageBlocks) {
      const source = asRecord(block)
      if (source === undefined) continue
      const target: Record<string, unknown> = { ...source }
      if (typeof pageIndex === 'number' && Number.isSafeInteger(pageIndex) && pageIndex >= 0) {
        target.page_idx = pageIndex
      }

      const type = typeof source.type === 'string' ? source.type.toLowerCase() : undefined
      if (type === 'doc_title' || type === 'paragraph_title') {
        target.type = 'title'
      }
      const level = paragraphTitleLevel(type, source)
      if (level !== undefined) target.text_level = level
      delete target.level

      if (typeof source.image_source === 'string' && target.img_path === undefined) {
        target.img_path = source.image_source
      }
      delete target.image_source

      const isTable = type === 'table'
      const captions = captionStrings(source.captions)
      if (captions.length > 0) {
        if (isTable) target.table_caption = captions
        else target.image_caption = captions
      }
      const footnotes = captionStrings(source.footnotes)
      if (footnotes.length > 0) {
        if (isTable) target.table_footnote = footnotes
        else target.image_footnote = footnotes
      }
      delete target.captions
      delete target.footnotes
      blocks.push(target)
    }
  }
  return blocks
}

/**
 * The plugin's canonical layout document exposes the ordered page list as `pdf_info[]`.
 * MinerU 4.x publishes the same list as `pages[]`; keep the upstream document and add the
 * canonical alias so physical page bounds stay verifiable.
 */
export function canonicalizeLayoutDocument(parsed: unknown): Record<string, unknown> | undefined {
  const document = asRecord(parsed)
  if (document === undefined) return undefined
  if (Array.isArray(document.pdf_info)) return undefined
  const pages = document.pages
  if (!Array.isArray(pages)) return undefined
  return { ...document, pdf_info: pages }
}

/**
 * Rewrites the two MinerU 4.x document shapes into canonical artifacts on their way into
 * staging; every other entry is streamed through untouched.
 */
export function canonicalizingSink(sink: ArtifactSink): ArtifactSink {
  return {
    writeTemporary: async (name, input, maxBytes) => await sink.writeTemporary(name, input, maxBytes),
    writeArtifact: async (
      fileId,
      kind,
      input: ArtifactInput,
      options: ArtifactWriteOptions,
    ): Promise<ArtifactRef> => {
      const canonicalize = kind === 'content-list'
        ? canonicalizeStructuredContent
        : kind === 'layout'
          ? canonicalizeLayoutDocument
          : undefined
      if (canonicalize === undefined) {
        return await sink.writeArtifact(fileId, kind, input, options)
      }
      const raw = await readArtifactInputText(input, options.maxBytes)
      let canonical: unknown
      try {
        canonical = canonicalize(JSON.parse(raw) as unknown)
      } catch {
        canonical = undefined
      }
      return canonical === undefined
        ? await sink.writeArtifact(fileId, kind, raw, options)
        : await sink.writeArtifact(fileId, kind, JSON.stringify(canonical), options)
    },
  }
}
