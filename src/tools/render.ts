import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { formatResultProse } from '../reader/prose.js'
import type { ResultView } from '../reader/views.js'

const DEFAULT_RENDER_LIMIT = 200_000

function clampRenderText(rendered: string, limit = DEFAULT_RENDER_LIMIT): string {
  if (!Number.isSafeInteger(limit) || limit <= 0) return ''
  if (rendered.length <= limit) return rendered
  // Never preserve a "complete" footer after slicing away its evidence.
  return '[RESULT_TOO_LARGE] Reader output could not be delivered intact; narrow the request or increase the output budget.'.slice(0, limit)
}

/** Model content for read_pdf: bounded prose followed by the attached images. */
export function renderResult(value: ResultView): ContentBlock[] {
  const limit = (typeof value.output_limit_chars === 'number' && Number.isSafeInteger(value.output_limit_chars) && value.output_limit_chars > 0)
    ? value.output_limit_chars
    : DEFAULT_RENDER_LIMIT
  const textBlock: ContentBlock = { type: 'text', text: clampRenderText(formatResultProse(value), limit) }
  const imageBlocks: ContentBlock[] = (value.inlined_images ?? []).map(img => {
    const attachment: ImageAttachmentRef = {
      attachmentId: img.attachment_id as ImageAttachmentRef['attachmentId'],
      mediaType: img.media_type as ImageMediaType,
      bytes: img.bytes ?? 0,
      width: img.width ?? 0,
      height: img.height ?? 0,
      ...(img.name !== undefined ? { name: img.name } : {}),
    }
    return { type: 'image' as const, attachment }
  })
  return [textBlock, ...imageBlocks]
}

// DSH's schema inference uses mutable JSON arrays. Domain views stay readonly;
// this type-only boundary does not mutate them (the tool runtime snapshots output).
export type MutableJsonView<T> = T extends readonly (infer Item)[]
  ? MutableJsonView<Item>[]
  : T extends object ? { -readonly [Key in keyof T]: MutableJsonView<T[Key]> } : T
