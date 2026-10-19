import { safeStringSlice } from '../utils/text.js'
import { getBlockCategory } from './projection.js'
import type { ContentListBlock, DocumentHeading, DocumentSummary } from './views.js'

const MAX_SYNOPSIS_HEADINGS = 20
const MAX_SYNOPSIS_TITLE_CHARS = 160

export function computeDocumentSummary(
  contentList: readonly ContentListBlock[],
): DocumentSummary {
  const maxPage = contentList.reduce((max, b) => typeof b.page_idx === 'number' ? Math.max(max, b.page_idx) : max, -1)
  const page_count = maxPage >= 0 ? maxPage + 1 : undefined
  const table_count = contentList.filter(b => getBlockCategory(b.type) === 'table').length
  const image_count = contentList.filter(b => getBlockCategory(b.type) === 'image').length
  const equation_count = contentList.filter(b => {
    const t = (b.type ?? '').toLowerCase()
    return t === 'equation' || t === 'interline_equation' || t === 'inline_equation'
  }).length

  const toc: DocumentHeading[] = []
  for (const b of contentList) {
    const page = typeof b.page_idx === 'number' && Number.isSafeInteger(b.page_idx) && b.page_idx >= 0 ? b.page_idx + 1 : undefined
    if (typeof b.text_level === 'number' && b.text_level >= 1 && b.text_level <= 6) {
      const title = String(b.text ?? b.content ?? '').trim().replace(/^#{1,6}\s+/, '')
      if (title) toc.push({ level: b.text_level, title, ...(page === undefined ? {} : { page }), ...(b.block_id ? { block_id: b.block_id } : {}) })
    } else if (b.type === 'title') {
      const title = String(b.text ?? b.content ?? '').trim().replace(/^#{1,6}\s+/, '')
      if (title) toc.push({ level: 1, title, ...(page === undefined ? {} : { page }), ...(b.block_id ? { block_id: b.block_id } : {}) })
    } else if (typeof b.text === 'string' && /^#{1,6}\s+/.test(b.text)) {
      const m = b.text.match(/^(#{1,6})\s+(.+)$/)
      if (m) toc.push({ level: m[1]!.length, title: m[2]!.trim(), ...(page === undefined ? {} : { page }), ...(b.block_id ? { block_id: b.block_id } : {}) })
    }
  }

  return {
    ...(page_count !== undefined ? { page_count } : {}),
    table_count,
    image_count,
    equation_count,
    toc,
  }
}

/** Parse-completion synopsis: counts plus a shortened outline, never body text. */
export function synopsisSummary(blocks: readonly ContentListBlock[]): { readonly summary?: DocumentSummary; readonly shortened: boolean } {
  if (blocks.length === 0) return { shortened: false }
  const full = computeDocumentSummary(blocks)
  const headings = full.toc ?? []
  const toc = headings.slice(0, MAX_SYNOPSIS_HEADINGS).map(heading => ({
    ...heading, title: safeStringSlice(heading.title, MAX_SYNOPSIS_TITLE_CHARS),
  }))
  return {
    summary: { ...full, toc },
    shortened: headings.length > toc.length || headings.some(heading => heading.title.length > MAX_SYNOPSIS_TITLE_CHARS),
  }
}
