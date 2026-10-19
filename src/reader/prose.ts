import type { ContentStatus, ParseSummaryView, ResultView } from './views.js'

export function formatResultProse(value: ResultView): string {
  const status: ContentStatus = value.content_status ?? (value.markdown_content !== undefined ? 'complete' : 'not_requested')
  const lines: string[] = []
  const content = value.markdown_content
  if (value.files.length > 0) {
    for (let i = 0; i < value.files.length; i++) {
      const file = value.files[i]!
      if (lines.length > 0) lines.push('')
      lines.push('# Document: ' + file.name)
      if (i === 0 && content !== undefined) {
        lines.push('', content)
      }
      const secondary = file.artifacts.filter(artifact => artifact.kind !== 'markdown')
      if (secondary.length > 0) {
        lines.push('', 'Artifacts: ' + secondary.map(a => a.kind + ' (' + String(a.bytes) + ' bytes): ' + a.path).join(', '))
      }
      if (file.artifacts_truncated) {
        lines.push('', '*(Artifact list truncated to output limit)*')
      }
    }
  } else if (content !== undefined) {
    lines.push(content)
  }

  if (status === 'partial' && value.toc && value.toc.length > 0) {
    lines.push('', 'Document Outline:')
    for (const heading of value.toc) {
      const indent = '  '.repeat(Math.max(0, heading.level - 1))
      const location = heading.page !== undefined ? ` (Page ${String(heading.page)})` : (heading.line !== undefined ? ` (line ${String(heading.line)})` : '')
      lines.push(`${indent}- ${heading.title}${location}${heading.block_id ? ' [' + heading.block_id + ']' : ''}`)
    }
    if (typeof value.cursor === 'string' && value.cursor.length > 0) lines.push('', 'Continue with the returned cursor using the same file_path.')
  }

  const totalPages = value.summary?.page_count
  const pagesLabel = value.pages ?? (totalPages !== undefined ? (totalPages > 1 ? `1-${totalPages}` : '1') : undefined)
  const pagesParts: string[] = []
  if (pagesLabel !== undefined) pagesParts.push(`Pages: ${pagesLabel}`)
  if (totalPages !== undefined) pagesParts.push(`${value.summary?.page_count_source === 'content-list-lower-bound' ? 'Parsed page lower bound' : 'Total Pages'}: ${String(totalPages)}`)
  const pagesInfo = pagesParts.length > 0 ? pagesParts.join(', ') + '. ' : ''

  let footer: string
  if (status === 'complete') {
    footer = '\n---\n[Status: Content complete. ' + pagesInfo + 'Selected parsed text complete across this and preceding chunks; not a guarantee of OCR fidelity or visual coverage.]'
  } else if (status === 'partial') {
    const mdGuidance = typeof value.cursor === 'string' && value.cursor.length > 0
      ? `Continue with read_pdf({ file_path: "<same file_path>", cursor: "${value.cursor}" }); omit pages/focus.`
      : 'Full markdown artifact available in local result storage.'
    footer = '\n---\n[Status: Content partial (truncated to output limit). ' + pagesInfo + mdGuidance + ']'
  } else {
    footer = '\n---\n[Status: Markdown content was not requested.' + (pagesParts.length > 0 ? ' ' + pagesParts.join(', ') + '.' : '') + ']'
  }
  if (value.provenance) {
    const p = value.provenance
    lines.push('', `Parse provenance: ${p.provider}/${p.model}, method ${p.parse_method}; upstream engine version unknown. Index v${p.index_version}, reader protocol v${p.reader_version}.`)
  }
  if (value.diagnostics?.length) lines.push('', 'Diagnostics:', ...value.diagnostics.map(d => `- [${d.code}] (${d.scope})${d.block_id ? ' [' + d.block_id + ']' : ''}${d.page === undefined ? '' : ' Page ' + d.page}: ${d.message}`))
  if (value.verification_hints?.length) lines.push('', 'Formula verification suggested (advisory, not a detected error):', ...value.verification_hints.map(hint => `- [${hint.block_id}]${hint.page === undefined ? '' : ' Page ' + hint.page}: inspect the original page before relying on formula symbols.`))
  if (value.metadata_shortened?.length) lines.push('', 'Metadata shortened to fit: ' + value.metadata_shortened.join(', ') + '. Narrow the selection to inspect omitted details.')
  if (value.view === 'page') lines.push('', 'Original PDF page rendered locally' + (value.renderer ? ' (' + value.renderer + ')' : '') + '; no Provider parsing was performed.')
  if (value.visuals) lines.push('', `Visuals in this chunk: ${value.visuals.attached}/${value.visuals.listed} attached, ${value.visuals.omitted} not attached.`)
  if (value.continuation_block) lines.push('', 'Continuing block [' + value.continuation_block.block_id + ']' + (value.continuation_block.page ? ' (Page ' + value.continuation_block.page + ')' : ''))
  lines.push(footer)
  if (value.warnings && value.warnings.length > 0) lines.push('', 'Warnings:', ...value.warnings.map(warning => `- ${warning}`))

  if (value.inlined_images && value.inlined_images.length > 0) {
    lines.push('', '**Inlined Visual Figures**:')
    for (let idx = 0; idx < value.inlined_images.length; idx++) {
      const img = value.inlined_images[idx]!
      const dim = (img.width !== undefined && img.height !== undefined) ? ` (${String(img.width)}x${String(img.height)})` : ''
      const label = value.view === 'page' ? 'Original PDF Page ' + img.page : img.document_label ?? (img.block_id ? 'Image [' + img.block_id + ']' : 'Figure ' + String(img.figure ?? idx + 1))
      lines.push(`- ${label}: ${img.name}${dim}`)
    }
  }
  if (value.ordered_images && value.ordered_images.length > 0) {
    for (let idx = 0; idx < value.ordered_images.length; idx++) {
      const img = value.ordered_images[idx]!
      const pageStr = img.page !== undefined ? `Page ${String(img.page)}` : ''
      const capStr = img.caption ? `"${img.caption}"` : ''
      const meta = [pageStr, capStr].filter(Boolean).join(', ')
      const metaStr = meta ? ` (${meta})` : ''
      const status = img.status && img.status !== 'available' ? ` [${img.status}]` : ''
      const label = img.document_label ?? (img.block_id ? 'Image' : 'Figure ' + String(idx + 1))
      const target = img.block_id ? '[' + img.block_id + ']' : img.path || 'unavailable'
      lines.push(`${label}${metaStr}: ${target}${status}`)
    }
  }

  return lines.join('\n')
}

export function formatSingleSummaryProse(value: ParseSummaryView): string {
  const file = value.files[0]
  const fileName = file?.name ?? 'Document'
  const summary = value.summary
  const lines = [
    `**MinerU Document Parse Summary** (Source: ${value.source}, Cache: ${value.cache_hit ? 'hit' : 'miss'})`,
    '',
    `# Document: ${fileName}`,
  ]

  if (summary?.page_count !== undefined) {
    lines.push(`- **Total Pages**: ${String(summary.page_count)}`)
  }
  if (summary?.table_count !== undefined) {
    lines.push(`- **Tables**: ${String(summary.table_count)}`)
  }
  if (summary?.image_count !== undefined) {
    lines.push(`- **Figures / Images**: ${String(summary.image_count)}`)
  }
  if (summary?.equation_count !== undefined && summary.equation_count > 0) {
    lines.push(`- **Formulas / Equations**: ${String(summary.equation_count)}`)
  }

  const outline = summary?.toc ?? value.toc
  if (outline && outline.length > 0) {
    lines.push('', '**Document Outline**:')
    for (const heading of outline) {
      const indent = '  '.repeat(Math.max(0, heading.level - 1))
      const pageInfo = heading.page !== undefined ? ` (Page ${String(heading.page)})` : (heading.line !== undefined ? ` (line ${String(heading.line)})` : '')
      lines.push(`${indent}- ${heading.title}${pageInfo}`)
    }
  }

  if (value.warnings?.length) lines.push('', ...value.warnings.map(warning => 'Note: ' + warning))

  lines.push(
    '',
    '---',
    '**Next Steps**: The document has been fully parsed and cached in local storage. Use `read_pdf` to inspect content on demand:',
    '- Reuse the original file_path for a page selection: `read_pdf({ file_path: "<same file_path>", pages: "1-3" })`',
    '- Reuse the original file_path for tables: `read_pdf({ file_path: "<same file_path>", focus: "table" })`',
    '- Reuse the original file_path for figures/images: `read_pdf({ file_path: "<same file_path>", focus: "image" })`',
    '- Reuse the original file_path for outline / TOC: `read_pdf({ file_path: "<same file_path>", focus: "toc" })`',
    '- Reuse the original file_path for complete text: `read_pdf({ file_path: "<same file_path>" })`',
  )

  return lines.join('\n')
}
