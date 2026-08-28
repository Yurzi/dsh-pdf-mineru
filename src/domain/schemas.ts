/**
 * schemas.ts — Strict runtime parsers and validators for persistent domain JSON records.
 *
 * Enforces:
 *   - Pinned schemaVersion validation (unknown versions rejected)
 *   - Closed record shapes (additional/unknown properties rejected)
 *   - Safe, branded identifier validation
 *   - Clean POSIX relative paths for artifact references (rejection of traversal, absolute paths, NUL, backslashes)
 *   - Elimination of local source paths, tokens, query parameters, presigned/CDN URLs from persistent records
 */

import {
  asCacheKey,
  asFileId,
  asProviderConfigId,
  asResultId,
} from './ids.js'
import {
  ARTIFACT_KINDS,
  CANONICAL_PARSE_REQUEST_SCHEMA_VERSION,
  normalizeArtifactKinds,
  normalizePageRanges,
  type ArtifactKind,
  type CanonicalParseRequest,
  type CanonicalSourceFile,
  type MinerUModel,
  type ParseMethod,
  type ParseSemantics,
} from './request.js'
import {
  MINERU_RESULT_MANIFEST_SCHEMA_VERSION,
  type ArtifactRef,
  type ParsedDocumentManifest,
  type ResultProducer,
  type MinerUResultManifest,
} from './result.js'
import type { MinerUProviderId } from './errors.js'
import type { ProviderJobRef, ProviderSubmittedFile } from '../providers/provider.js'

export const VALID_MODELS = new Set<MinerUModel>(['pipeline', 'vlm'])
export const VALID_PARSE_METHODS = new Set<ParseMethod>(['auto', 'txt', 'ocr'])
export const VALID_PROVIDERS = new Set<MinerUProviderId>(['self-hosted-v2', 'official-v4'])
export const VALID_ARTIFACT_KINDS = new Set<ArtifactKind>(ARTIFACT_KINDS)

const SHA256_HEX = /^[a-f0-9]{64}$/
const PAGE_RANGES = /^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9_.-]+$/
const URL_OR_SECRET_PATTERN = /(?:https?:\/\/|Bearer\s+|[?&\0\r\n])/i

export function assertPlainObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`)
  }
  const proto = Reflect.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError(`${label} must be a plain object`)
  }
  return value as Record<string, unknown>
}

export function assertNoAdditionalProperties(
  record: Record<string, unknown>,
  allowedKeys: readonly string[],
  label: string,
): void {
  const allowed = new Set(allowedKeys)
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new TypeError(`unknown property "${key}" in ${label}`)
    }
  }
}

export function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty string`)
  }
  return value
}

export function assertNonNegativeSafeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`)
  }
  return value
}

export function assertSha256(value: unknown, label = 'SHA-256 digest'): string {
  if (typeof value !== 'string' || !SHA256_HEX.test(value)) {
    throw new TypeError(`${label} must be a 64-character lowercase hexadecimal SHA-256 digest`)
  }
  return value
}

export function assertNoUrlOrSecret(value: string, label: string): string {
  if (URL_OR_SECRET_PATTERN.test(value)) {
    throw new TypeError(`${label} must not contain URLs, credentials, query parameters, or control characters`)
  }
  return value
}

export function assertSafeFileName(value: unknown, label = 'file name'): string {
  assertNonEmptyString(value, label)
  const str = value as string
  if (str.length > 255 || /[\u0000-\u001f\u007f]/.test(str)) {
    throw new TypeError(`${label} contains control characters or exceeds 255 characters`)
  }
  if (str.includes('/') || str.includes('\\') || str === '.' || str === '..') {
    throw new TypeError(`${label} "${str}" must not contain path separators or traversal segments`)
  }
  return str
}

export function assertSafeArtifactRelativePath(value: unknown, label = 'artifact relativePath'): string {
  assertNonEmptyString(value, label)
  const path = value as string
  assertNoUrlOrSecret(path, label)
  if (path.startsWith('/') || path.startsWith('\\') || path.startsWith('./') || path.startsWith('../')) {
    throw new TypeError(`${label} "${path}" must be a relative path and cannot start with / or ./ or ../`)
  }
  if (path.includes('\\') || path.includes('//') || path.includes('\0')) {
    throw new TypeError(`${label} "${path}" contains invalid path separators or control characters`)
  }
  const segments = path.split('/')
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..' || !SAFE_PATH_SEGMENT.test(seg)) {
      throw new TypeError(`${label} "${path}" contains invalid or traversal path segment "${seg}"`)
    }
  }
  return path
}

export function parseArtifactKind(input: unknown): ArtifactKind {
  if (typeof input !== 'string' || !VALID_ARTIFACT_KINDS.has(input as ArtifactKind)) {
    throw new TypeError(`invalid artifact kind: "${String(input)}"`)
  }
  return input as ArtifactKind
}

export function parseParseSemantics(input: unknown): ParseSemantics {
  const obj = assertPlainObject(input, 'ParseSemantics')
  assertNoAdditionalProperties(
    obj,
    ['model', 'ocr', 'parseMethod', 'language', 'formula', 'table', 'pages'],
    'ParseSemantics',
  )

  const model = obj['model']
  if (typeof model !== 'string' || !VALID_MODELS.has(model as MinerUModel)) {
    throw new TypeError(`invalid ParseSemantics.model: "${String(model)}"`)
  }

  const ocr = obj['ocr']
  if (typeof ocr !== 'boolean') {
    throw new TypeError('ParseSemantics.ocr must be a boolean')
  }

  const parseMethod = obj['parseMethod']
  if (typeof parseMethod !== 'string' || !VALID_PARSE_METHODS.has(parseMethod as ParseMethod)) {
    throw new TypeError(`invalid ParseSemantics.parseMethod: "${String(parseMethod)}"`)
  }

  if (ocr !== (parseMethod === 'ocr')) {
    throw new TypeError('ParseSemantics.ocr must agree with ParseSemantics.parseMethod')
  }

  const language = assertNonEmptyString(obj['language'], 'ParseSemantics.language')
  assertNoUrlOrSecret(language, 'ParseSemantics.language')

  const formula = obj['formula']
  if (typeof formula !== 'boolean') {
    throw new TypeError('ParseSemantics.formula must be a boolean')
  }

  const table = obj['table']
  if (typeof table !== 'boolean') {
    throw new TypeError('ParseSemantics.table must be a boolean')
  }

  let pages: string | undefined
  if (obj['pages'] !== undefined) {
    const rawPages = assertNonEmptyString(obj['pages'], 'ParseSemantics.pages')
    if (!PAGE_RANGES.test(rawPages) || normalizePageRanges(rawPages) !== rawPages) {
      throw new TypeError(`ParseSemantics.pages is not canonical: "${rawPages}"`)
    }
    pages = rawPages
  }

  return {
    model: model as MinerUModel,
    ocr,
    parseMethod: parseMethod as ParseMethod,
    language,
    formula,
    table,
    ...(pages === undefined ? {} : { pages }),
  }
}

export function parseCanonicalSourceFile(input: unknown): CanonicalSourceFile {
  const obj = assertPlainObject(input, 'CanonicalSourceFile')
  assertNoAdditionalProperties(obj, ['fileId', 'name', 'bytes', 'sha256'], 'CanonicalSourceFile')

  const fileId = asFileId(assertNonEmptyString(obj['fileId'], 'CanonicalSourceFile.fileId'))
  const name = assertSafeFileName(obj['name'], 'CanonicalSourceFile.name')
  const bytes = assertNonNegativeSafeInteger(obj['bytes'], 'CanonicalSourceFile.bytes')
  const sha256 = assertSha256(obj['sha256'], 'CanonicalSourceFile.sha256')

  return { fileId, name, bytes, sha256 }
}

export function parseCanonicalParseRequest(input: unknown): CanonicalParseRequest {
  const obj = assertPlainObject(input, 'CanonicalParseRequest')
  assertNoAdditionalProperties(
    obj,
    ['schemaVersion', 'files', 'semantics', 'requiredArtifacts'],
    'CanonicalParseRequest',
  )

  if (obj['schemaVersion'] !== CANONICAL_PARSE_REQUEST_SCHEMA_VERSION) {
    throw new TypeError(
      `invalid CanonicalParseRequest schemaVersion: expected ${CANONICAL_PARSE_REQUEST_SCHEMA_VERSION}, got ${String(obj['schemaVersion'])}`,
    )
  }

  if (!Array.isArray(obj['files']) || obj['files'].length === 0) {
    throw new TypeError('CanonicalParseRequest.files must be a non-empty array')
  }
  const files = obj['files'].map(f => parseCanonicalSourceFile(f))

  const semantics = parseParseSemantics(obj['semantics'])

  if (!Array.isArray(obj['requiredArtifacts']) || obj['requiredArtifacts'].length === 0) {
    throw new TypeError('CanonicalParseRequest.requiredArtifacts must be a non-empty array')
  }
  const requiredArtifacts = obj['requiredArtifacts'].map(k => parseArtifactKind(k))
  if (new Set(requiredArtifacts).size !== requiredArtifacts.length) {
    throw new TypeError('CanonicalParseRequest.requiredArtifacts cannot contain duplicates')
  }
  const normalizedArtifacts = normalizeArtifactKinds(requiredArtifacts)
  if (normalizedArtifacts.length !== requiredArtifacts.length
    || normalizedArtifacts.some((kind, index) => kind !== requiredArtifacts[index])) {
    throw new TypeError('CanonicalParseRequest.requiredArtifacts must be canonical and include markdown')
  }

  return {
    schemaVersion: CANONICAL_PARSE_REQUEST_SCHEMA_VERSION,
    files,
    semantics,
    requiredArtifacts,
  }
}

export function parseProviderSubmittedFile(input: unknown): ProviderSubmittedFile {
  const obj = assertPlainObject(input, 'ProviderSubmittedFile')
  assertNoAdditionalProperties(obj, ['dataId', 'fileId', 'name'], 'ProviderSubmittedFile')

  const dataId = assertNoUrlOrSecret(
    assertNonEmptyString(obj['dataId'], 'ProviderSubmittedFile.dataId'),
    'ProviderSubmittedFile.dataId',
  )
  const fileId = asFileId(assertNonEmptyString(obj['fileId'], 'ProviderSubmittedFile.fileId'))
  const name = assertSafeFileName(obj['name'], 'ProviderSubmittedFile.name')

  return { dataId, fileId, name }
}

export function parseProviderJobRef(input: unknown): ProviderJobRef {
  const obj = assertPlainObject(input, 'ProviderJobRef')
  const provider = obj['provider']

  if (provider === 'self-hosted-v2') {
    assertNoAdditionalProperties(obj, ['provider', 'taskId', 'files'], 'ProviderJobRef (self-hosted-v2)')
    const taskId = assertNoUrlOrSecret(
      assertNonEmptyString(obj['taskId'], 'ProviderJobRef.taskId'),
      'ProviderJobRef.taskId',
    )
    if (!Array.isArray(obj['files'])) {
      throw new TypeError('ProviderJobRef.files must be an array')
    }
    const files = obj['files'].map(f => parseProviderSubmittedFile(f))
    return { provider: 'self-hosted-v2', taskId, files }
  }

  if (provider === 'official-v4') {
    assertNoAdditionalProperties(obj, ['provider', 'batchId', 'files'], 'ProviderJobRef (official-v4)')
    const batchId = assertNoUrlOrSecret(
      assertNonEmptyString(obj['batchId'], 'ProviderJobRef.batchId'),
      'ProviderJobRef.batchId',
    )
    if (!Array.isArray(obj['files'])) {
      throw new TypeError('ProviderJobRef.files must be an array')
    }
    const files = obj['files'].map(f => parseProviderSubmittedFile(f))
    return { provider: 'official-v4', batchId, files }
  }

  throw new TypeError(`unknown provider in ProviderJobRef: "${String(provider)}"`)
}

export function parseArtifactRef(input: unknown): ArtifactRef {
  const obj = assertPlainObject(input, 'ArtifactRef')
  assertNoAdditionalProperties(
    obj,
    ['kind', 'relativePath', 'mediaType', 'bytes', 'sha256'],
    'ArtifactRef',
  )

  const kind = obj['kind']
  if (typeof kind !== 'string' || (kind !== 'manifest' && !VALID_ARTIFACT_KINDS.has(kind as ArtifactKind))) {
    throw new TypeError(`invalid ArtifactRef.kind: "${String(kind)}"`)
  }

  const relativePath = assertSafeArtifactRelativePath(obj['relativePath'], 'ArtifactRef.relativePath')
  const mediaType = assertNoUrlOrSecret(
    assertNonEmptyString(obj['mediaType'], 'ArtifactRef.mediaType'),
    'ArtifactRef.mediaType',
  )
  const bytes = assertNonNegativeSafeInteger(obj['bytes'], 'ArtifactRef.bytes')
  const sha256 = assertSha256(obj['sha256'], 'ArtifactRef.sha256')

  return {
    kind: kind as ArtifactKind | 'manifest',
    relativePath,
    mediaType,
    bytes,
    sha256,
  }
}

export function parseParsedDocumentManifest(input: unknown): ParsedDocumentManifest {
  const obj = assertPlainObject(input, 'ParsedDocumentManifest')
  assertNoAdditionalProperties(obj, ['fileId', 'name', 'artifacts'], 'ParsedDocumentManifest')

  const fileId = asFileId(assertNonEmptyString(obj['fileId'], 'ParsedDocumentManifest.fileId'))
  const name = assertSafeFileName(obj['name'], 'ParsedDocumentManifest.name')

  if (!Array.isArray(obj['artifacts']) || obj['artifacts'].length === 0) {
    throw new TypeError('ParsedDocumentManifest.artifacts must be a non-empty array')
  }
  const artifacts = obj['artifacts'].map(a => parseArtifactRef(a))

  return { fileId, name, artifacts }
}

export function parseResultProducer(input: unknown): ResultProducer {
  const obj = assertPlainObject(input, 'ResultProducer')
  assertNoAdditionalProperties(obj, ['providerId', 'providerConfigId', 'compatibilityKey'], 'ResultProducer')

  const providerId = obj['providerId']
  if (typeof providerId !== 'string' || !VALID_PROVIDERS.has(providerId as MinerUProviderId)) {
    throw new TypeError(`invalid ResultProducer.providerId: "${String(providerId)}"`)
  }

  const providerConfigId = asProviderConfigId(
    assertNonEmptyString(obj['providerConfigId'], 'ResultProducer.providerConfigId'),
  )

  const compatibilityKey = assertNoUrlOrSecret(
    assertNonEmptyString(obj['compatibilityKey'], 'ResultProducer.compatibilityKey'),
    'ResultProducer.compatibilityKey',
  )

  return {
    providerId: providerId as MinerUProviderId,
    providerConfigId,
    compatibilityKey,
  }
}

export function parseMinerUResultManifest(input: unknown): MinerUResultManifest {
  const obj = assertPlainObject(input, 'MinerUResultManifest')
  assertNoAdditionalProperties(
    obj,
    ['schemaVersion', 'id', 'cacheKey', 'sourceSha256', 'request', 'producer', 'files', 'createdAt'],
    'MinerUResultManifest',
  )

  if (obj['schemaVersion'] !== MINERU_RESULT_MANIFEST_SCHEMA_VERSION) {
    throw new TypeError(
      `invalid MinerUResultManifest schemaVersion: expected ${MINERU_RESULT_MANIFEST_SCHEMA_VERSION}, got ${String(obj['schemaVersion'])}`,
    )
  }

  const id = asResultId(assertNonEmptyString(obj['id'], 'MinerUResultManifest.id'))
  const cacheKey = asCacheKey(assertNonEmptyString(obj['cacheKey'], 'MinerUResultManifest.cacheKey'))
  const sourceSha256 = assertSha256(obj['sourceSha256'], 'MinerUResultManifest.sourceSha256')
  const request = parseCanonicalParseRequest(obj['request'])
  const producer = parseResultProducer(obj['producer'])

  if (!Array.isArray(obj['files']) || obj['files'].length !== 1) {
    throw new TypeError('MinerUResultManifest.files must be a tuple with exactly one ParsedDocumentManifest')
  }
  const document = parseParsedDocumentManifest(obj['files'][0])
  const files: readonly [ParsedDocumentManifest] = [document]

  const createdAt = assertNonNegativeSafeInteger(obj['createdAt'], 'MinerUResultManifest.createdAt')

  return {
    schemaVersion: MINERU_RESULT_MANIFEST_SCHEMA_VERSION,
    id,
    cacheKey,
    sourceSha256,
    request,
    producer,
    files,
    createdAt,
  }
}
