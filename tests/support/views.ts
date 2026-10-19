import { isJsonValue, type JsonValue } from '@deepseek-ai/dsh-util-values'
import type {
  ImageCandidateView, InlinedImageView, ParseSummaryView, ResultFileView, ResultView,
} from '../../src/reader/views.js'

/** A minimal completed read_pdf value; override any wire field. */
export function resultView(overrides: Partial<ResultView> = {}): ResultView {
  return {
    state: 'completed', source: 'cache', cache_hit: true, result_id: 'mr_fixture',
    files: [resultFile()], content_status: 'complete', cursor: null, output_limit_chars: 12_000,
    ...overrides,
  }
}

export function resultFile(overrides: Partial<ResultFileView> = {}): ResultFileView {
  return { file_id: 'mf_fixture', name: 'paper.pdf', artifacts: [], ...overrides }
}

/** A completed async_parse_pdf summary value. */
export function summaryView(overrides: Partial<ParseSummaryView> = {}): ParseSummaryView {
  return {
    state: 'completed', source: 'cache', cache_hit: true, result_id: 'mr_fixture',
    files: [resultFile()], content_status: 'not_requested', ...overrides,
  }
}

export function imageCandidate(overrides: Partial<ImageCandidateView> = {}): ImageCandidateView {
  return { path: '/cache/images/figure.png', name: 'figure.png', media_type: 'image/png', bytes: 13, ...overrides }
}

export function inlinedImage(overrides: Partial<InlinedImageView> = {}): InlinedImageView {
  return { attachment_id: 'sha256:' + 'a'.repeat(64), name: 'figure.png', media_type: 'image/png', ...overrides }
}

/** A partial result at the list-size extremes the reader can emit (100 images/headings/diagnostics). */
export function maximalResultView(): ResultView {
  const many = <T>(item: (index: number) => T): T[] => Array.from({ length: 100 }, (_, index) => item(index))
  return resultView({
    result_id: 'mr_maximal', content_status: 'partial', cursor: 'opaque-cursor', output_limit_chars: 200_000,
    files: [resultFile({ file_id: 'mf_maximal', artifacts: many(() => ({ kind: 'images', path: '/cache/image.png', bytes: 100 })) })],
    markdown_content: 'Evidence '.repeat(100), renderer: 'pdfjs',
    ordered_images: many(() => imageCandidate()),
    inlined_images: many(() => inlinedImage()),
    toc: many(() => ({ level: 1, title: 'Heading' })),
    warnings: many(() => 'Warning'),
    diagnostics: many(index => ({ id: 'd' + String(index), code: 'notice', scope: 'chunk' as const, message: 'Diagnostic' })),
    verification_hints: many(() => ({ reason: 'formula' as const, block_id: 'mr_maximal:b1', view: 'page' as const })),
  })
}

/** The detached lossless-JSON copy the tool runtime hands to output projections. */
export function jsonValue(view: ResultView): JsonValue {
  if (!isJsonValue(view)) throw new TypeError('fixture is not lossless JSON')
  const value: JsonValue = JSON.parse(JSON.stringify(view))
  return value
}

/** Recursively freeze a fixture so pure projections cannot mutate it unnoticed. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}
