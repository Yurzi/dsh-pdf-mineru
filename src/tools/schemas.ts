import type { ObjectValueSchemaSpec, ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import { PROVIDER_TYPES } from '../domain/ids.js'

/** Model-facing parameter and output schemas. Every object declares additionalProperties. */

const artifactViewSchema = {
  type: 'object',
  properties: { kind: { type: 'string', required: true }, path: { type: 'string', required: true }, bytes: { type: 'integer', required: true } },
  additionalProperties: false,
} satisfies ObjectValueSchemaSpec

const inlinedImageViewSchema = {
  type: 'object',
  properties: {
    block_id: { type: 'string' },
    document_label: { type: 'string' },
    page: { type: 'integer' },
    attachment_id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    media_type: { type: 'string', required: true },
    width: { type: 'integer' },
    height: { type: 'integer' },
    bytes: { type: 'integer' },
    figure: { type: 'integer', description: 'Attachment selection index only; use document_label for the original paper figure number.' },
  },
  additionalProperties: false,
} satisfies ObjectValueSchemaSpec

const imageCandidateViewSchema = {
  type: 'object',
  properties: {
    block_id: { type: 'string' },
    document_label: { type: 'string' },
    path: { type: 'string', required: true },
    name: { type: 'string', required: true },
    page: { type: 'integer' },
    caption: { type: 'string' },
    media_type: { type: 'string', required: true },
    bytes: { type: 'integer', required: true },
    status: { type: 'string', enum: ['available', 'unavailable', 'unsupported', 'failed', 'omitted'] },
  },
  additionalProperties: false,
} satisfies ObjectValueSchemaSpec

const documentHeadingSchema = {
  type: 'object',
  properties: {
    block_id: { type: 'string' },
    level: { type: 'integer', required: true },
    title: { type: 'string', required: true },
    line: { type: 'integer' },
    page: { type: 'integer' },
  },
  additionalProperties: false,
} satisfies ObjectValueSchemaSpec

const documentSummarySchema = {
  type: 'object',
  properties: {
    page_count: { type: 'integer' },
    page_count_source: { type: 'string', enum: ['layout', 'content-list-lower-bound', 'pdfinfo', 'pdfjs'] },
    table_count: { type: 'integer' },
    image_count: { type: 'integer' },
    equation_count: { type: 'integer' },
    toc: { type: 'array', items: documentHeadingSchema },
  },
  additionalProperties: false,
} satisfies ObjectValueSchemaSpec

const resultFileViewSchema = {
  type: 'object',
  properties: {
    file_id: { type: 'string', required: true }, name: { type: 'string', required: true },
    artifacts: { type: 'array', items: artifactViewSchema, required: true }, artifacts_truncated: { type: 'boolean' },
    markdown_path: { type: 'string' },
  },
  additionalProperties: false,
} satisfies ObjectValueSchemaSpec

export const resultViewSchema = {
  type: 'object',
  properties: {
    state: { type: 'string', enum: ['completed'], required: true },
    source: { type: 'string', enum: ['cache', 'shared-operation', 'provider', 'local'], required: true },
    cache_hit: { type: 'boolean', required: true }, result_id: { type: 'string', required: true },
    files: { type: 'array', items: resultFileViewSchema, required: true },
    markdown_content: { type: 'string' },
    content_status: { type: 'string', enum: ['complete', 'partial', 'not_requested'], required: true },
    markdown_path: { type: 'string' },
    cursor: {
      oneOf: [{ type: 'string' }, { type: 'null' }],
      required: true,
      description: 'Non-empty continuation token when content_status is partial; null otherwise. Stop reading when null.',
    },
    warnings: { type: 'array', items: { type: 'string' } },
    provenance: { type: 'object', properties: { provider: { type: 'string', enum: [...PROVIDER_TYPES], required: true }, model: { oneOf: [{ type: 'string', enum: ['pipeline', 'vlm'] }, { type: 'null' }], required: true }, parse_method: { type: 'string', enum: ['auto', 'txt', 'ocr'], required: true }, upstream_version: { type: 'null', required: true }, index_version: { type: 'integer', required: true }, reader_version: { type: 'integer', required: true } }, additionalProperties: false },
    diagnostics: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', required: true }, code: { type: 'string', required: true }, scope: { type: 'string', enum: ['document', 'selection', 'chunk'], required: true }, message: { type: 'string', required: true }, block_id: { type: 'string' }, page: { type: 'integer' } }, additionalProperties: false } },
    verification_hints: { type: 'array', items: { type: 'object', properties: { reason: { type: 'string', enum: ['formula'], required: true }, block_id: { type: 'string', required: true }, page: { type: 'integer' }, view: { type: 'string', enum: ['page'], required: true } }, additionalProperties: false } },
    metadata_shortened: { type: 'array', items: { type: 'string', enum: ['summary', 'provenance', 'diagnostics', 'verification_hints', 'warnings'] } },
    manifest_path: { type: 'string' },
    source_sha256: { type: 'string' },
    continuation_block: { type: 'object', properties: { block_id: { type: 'string', required: true }, page: { type: 'integer' }, document_label: { type: 'string' } }, additionalProperties: false },
    view: { type: 'string', enum: ['content', 'page'] },
    renderer: { type: 'string', enum: ['poppler', 'pdfjs'] },
    visuals: { type: 'object', properties: { listed: { type: 'integer', required: true }, attached: { type: 'integer', required: true }, omitted: { type: 'integer', required: true }, scope: { type: 'string', enum: ['chunk'], required: true } }, additionalProperties: false },
    output_limit_chars: { type: 'integer', required: true },
    inlined_images: { type: 'array', items: inlinedImageViewSchema },
    ordered_images: { type: 'array', items: imageCandidateViewSchema },
    summary: documentSummarySchema,
    toc: { type: 'array', items: documentHeadingSchema },
    pages: { type: 'string' },
  },
  additionalProperties: false,
} satisfies ObjectValueSchemaSpec

export const asyncParseOutputSchema = {
  type: 'object',
  properties: { job_id: { type: 'string', required: true }, state: { type: 'string', enum: ['running'], required: true } },
  additionalProperties: false,
} satisfies ObjectValueSchemaSpec

const documentSourceParameters = {
  file_path: { type: 'string', description: 'Path of the local PDF document. Provide exactly one of file_path or attachment_id.' },
  attachment_id: { type: 'string', description: 'File attachment on the current session surface: full SHA-256 ID or unique 8–64 hex-character digest prefix, with optional sha256: prefix. Uses the DSH host file path; not a URL or filesystem path. Mutually exclusive with file_path.' },
} satisfies ParameterSchemaSpec

export const asyncParseParameters: ParameterSchemaSpec = documentSourceParameters

export const readPdfParameters: ParameterSchemaSpec = {
  ...documentSourceParameters,
  view: { type: 'string', enum: ['content', 'page'], description: 'content (default) reads parsed blocks; page renders one original PDF page locally without invoking a Provider. Requires exactly one page and an image-capable model.' },
  block_id: { type: 'string', description: 'Read one exact stable block ID from a prior result; IDs are bound to that parsed result. Cannot combine with query or cursor.' },
  query: { type: 'string', description: 'Case-insensitive literal search (1–256 characters) in selected parsed blocks. Returns bounded snippets and block IDs, not the full matching blocks. Use block_id to read a hit.' },
  expected_sha256: { type: 'string', description: 'Optional source_sha256 from a parsed result. In page view, reject changed sources before rendering.' },
  pages: {
    oneOf: [
      { type: 'integer', description: 'Single 1-based page number, e.g. 3' },
      { type: 'string', description: 'Page range string, e.g. "1-3, 5"' },
      { type: 'array', items: { type: 'integer' }, description: 'Array of page numbers, e.g. [1, 2, 5]' },
    ],
    description: '1-based page numbers to extract. Accepts a single page number (e.g. 3), an array of page numbers (e.g. [1, 2, 5]), or a range string (e.g. "1-3, 5").',
  },
  focus: {
    oneOf: [
      { type: 'string', enum: ['all', 'text', 'table', 'image', 'toc', 'artifacts'], description: 'Focus content type' },
      { type: 'array', items: { type: 'string', enum: ['all', 'text', 'table', 'image', 'toc', 'artifacts'] }, description: 'Focus content types' },
    ],
    description: 'Content types to extract: "all" (default), "text" (paragraphs, headers, code, formulas), "table" (tables and captions), "image" (charts, figures, and captions), "toc" (document outline / table of contents), or "artifacts" (secondary artifact files like layout.json, model.json, and extracted images). Accepts a single kind or an array.',
  },
  inline_images: {
    type: 'boolean',
    description: 'Whether to inline visual figures directly as multimodal image blocks. Defaults to true when calling model route supports images.',
  },
  poll_timeout_ms: {
    type: 'integer',
    description: 'Maximum synchronous wait in milliseconds. A timeout leaves the shared producer running; retry the same request to rejoin it.',
  },
  cursor: {
    type: 'string',
    description: 'Opaque continuation cursor returned by a previous partial read. Pass only a non-empty returned token, unchanged; null means stop, not restart. When provided, the same source (file_path or attachment_id) is required and pages/focus must be omitted.',
  },
}
