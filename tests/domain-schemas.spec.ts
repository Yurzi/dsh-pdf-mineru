import { describe, expect, it } from 'vitest'
import {
  parseArtifactKind,
  parseArtifactRef,
  parseCanonicalParseRequest,
  parseCanonicalSourceFile,
  parseMinerUResultManifest,
  parseParsedDocumentManifest,
  parseResultProducer,
} from '../src/domain/schemas.js'
import { asCacheKey, asFileId, asProviderConfigId, asResultId } from '../src/domain/ids.js'
import { CANONICAL_PARSE_REQUEST_SCHEMA_VERSION, type ArtifactKind } from '../src/domain/request.js'
import { MINERU_RESULT_MANIFEST_SCHEMA_VERSION } from '../src/domain/result.js'
import type { CanonicalParseRequest } from '../src/domain/request.js'
import type { MinerUResultManifest } from '../src/domain/result.js'

const SHA256_A = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const SHA256_B = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210'

const validCanonicalRequest: CanonicalParseRequest = {
  schemaVersion: 1,
  files: [
    {
      fileId: asFileId('mf_0123456789abcdef0123456789ab_0'),
      name: 'document.pdf',
      bytes: 1048576,
      sha256: SHA256_A,
    },
  ],
  semantics: {
    model: 'pipeline',
    ocr: true,
    parseMethod: 'ocr',
    language: 'ch',
    formula: true,
    table: true,
    pages: '1-10,15',
  },
  requiredArtifacts: ['markdown', 'layout', 'images'],
}

const validResultManifest: MinerUResultManifest = {
  schemaVersion: 1,
  id: asResultId('mr_0123456789abcdef0123456789abcdef'),
  cacheKey: asCacheKey(SHA256_A),
  sourceSha256: SHA256_A,
  request: validCanonicalRequest,
  producer: {
    providerId: 'self-hosted-v2',
    providerConfigId: asProviderConfigId('mp_local'),
    compatibilityKey: 'self-hosted-v2:hash123:3.4.4:pipeline',
  },
  files: [
    {
      fileId: asFileId('mf_0123456789abcdef0123456789ab_0'),
      name: 'document.pdf',
      artifacts: [
        {
          kind: 'markdown',
          relativePath: 'full.md',
          mediaType: 'text/markdown',
          bytes: 4096,
          sha256: SHA256_B,
        },
        {
          kind: 'images',
          relativePath: 'images/img_0.png',
          mediaType: 'image/png',
          bytes: 16384,
          sha256: SHA256_A,
        },
      ],
    },
  ],
  createdAt: 1700000010000,
}

describe('Domain Schemas Runtime Parsers', () => {
  describe('CanonicalParseRequest', () => {
    it('successfully parses a valid CanonicalParseRequest round-trip', () => {
      const parsed = parseCanonicalParseRequest(validCanonicalRequest)
      expect(parsed).toEqual(validCanonicalRequest)
      expect(parsed.schemaVersion).toBe(CANONICAL_PARSE_REQUEST_SCHEMA_VERSION)
    })

    it('accepts Unicode display names but rejects path separators', () => {
      expect(parseCanonicalSourceFile({
        ...validCanonicalRequest.files[0],
        name: '研究报告 2026.pdf',
      }).name).toBe('研究报告 2026.pdf')
      expect(() => parseCanonicalSourceFile({
        ...validCanonicalRequest.files[0],
        name: '../report.pdf',
      })).toThrow(/path separators/)
    })

    it('rejects unknown schemaVersion', () => {
      expect(() => parseCanonicalParseRequest({ ...validCanonicalRequest, schemaVersion: 2 })).toThrow(/schemaVersion/)
      expect(() => parseCanonicalParseRequest({ ...validCanonicalRequest, schemaVersion: 0 })).toThrow(/schemaVersion/)
      expect(() => parseCanonicalParseRequest({ ...validCanonicalRequest, schemaVersion: '1' })).toThrow(/schemaVersion/)
    })

    it('rejects additional/unknown properties in request root or sub-objects', () => {
      expect(() =>
        parseCanonicalParseRequest({
          ...validCanonicalRequest,
          extraField: 'not-allowed',
        }),
      ).toThrow(/unknown property "extraField"/)

      expect(() =>
        parseCanonicalParseRequest({
          ...validCanonicalRequest,
          files: [{ ...validCanonicalRequest.files[0], localPath: '/tmp/doc.pdf' }],
        }),
      ).toThrow(/unknown property "localPath"/)

      expect(() =>
        parseCanonicalParseRequest({
          ...validCanonicalRequest,
          semantics: { ...validCanonicalRequest.semantics, backend: 'hybrid-engine' },
        }),
      ).toThrow(/unknown property "backend"/)
    })

    it('rejects duplicate or invalid requiredArtifacts', () => {
      expect(() =>
        parseCanonicalParseRequest({
          ...validCanonicalRequest,
          requiredArtifacts: ['markdown', 'markdown'],
        }),
      ).toThrow(/duplicates/)

      expect(() =>
        parseCanonicalParseRequest({
          ...validCanonicalRequest,
          requiredArtifacts: ['markdown', 'invalid-kind' as unknown as ArtifactKind],
        }),
      ).toThrow(/invalid artifact kind/)

      expect(() =>
        parseCanonicalParseRequest({
          ...validCanonicalRequest,
          requiredArtifacts: [],
        }),
      ).toThrow(/non-empty array/)
    })


    it('rejects contradictory or noncanonical persisted semantics', () => {
      expect(() => parseCanonicalParseRequest({
        ...validCanonicalRequest,
        semantics: { ...validCanonicalRequest.semantics, ocr: false, parseMethod: 'ocr' },
      })).toThrow(/must agree/)
      for (const pages of ['15,1-3', '1-3,4-5', '0-2', '3-2']) {
        expect(() => parseCanonicalParseRequest({
          ...validCanonicalRequest, semantics: { ...validCanonicalRequest.semantics, pages },
        })).toThrow(/page/i)
      }
      for (const requiredArtifacts of [['layout'], ['layout', 'markdown']] as const) {
        expect(() => parseCanonicalParseRequest({ ...validCanonicalRequest, requiredArtifacts }))
          .toThrow(/canonical|markdown/)
      }
    })

  })

  describe('MinerUResultManifest & ArtifactRef', () => {
    it('successfully parses valid MinerUResultManifest round-trip', () => {
      const parsed = parseMinerUResultManifest(validResultManifest)
      expect(parsed).toEqual(validResultManifest)
      expect(parsed.schemaVersion).toBe(MINERU_RESULT_MANIFEST_SCHEMA_VERSION)
      expect(parsed.files).toHaveLength(1)
    })

    it('rejects unknown schemaVersion in MinerUResultManifest', () => {
      expect(() => parseMinerUResultManifest({ ...validResultManifest, schemaVersion: 2 })).toThrow(/schemaVersion/)
    })

    it('rejects manifest with zero or multiple files (must be single-file result)', () => {
      expect(() =>
        parseMinerUResultManifest({
          ...validResultManifest,
          files: [],
        }),
      ).toThrow(/exactly one ParsedDocumentManifest/)

      expect(() =>
        parseMinerUResultManifest({
          ...validResultManifest,
          files: [validResultManifest.files[0], validResultManifest.files[0]],
        }),
      ).toThrow(/exactly one ParsedDocumentManifest/)
    })

    it('rejects malicious or out-of-bounds artifact relativePath', () => {
      const makeRef = (relativePath: string) => ({
        kind: 'markdown',
        relativePath,
        mediaType: 'text/markdown',
        bytes: 100,
        sha256: SHA256_A,
      })

      // Absolute paths
      expect(() => parseArtifactRef(makeRef('/full.md'))).toThrow(/must be a relative path/)
      expect(() => parseArtifactRef(makeRef('/etc/passwd'))).toThrow(/must be a relative path/)

      // Directory traversal
      expect(() => parseArtifactRef(makeRef('../full.md'))).toThrow(/must be a relative path/)
      expect(() => parseArtifactRef(makeRef('images/../../full.md'))).toThrow(/traversal/)
      expect(() => parseArtifactRef(makeRef('images/./full.md'))).toThrow(/traversal/)
      expect(() => parseArtifactRef(makeRef('..'))).toThrow(/traversal/)

      // Backslashes and control characters
      expect(() => parseArtifactRef(makeRef('images\\img.png'))).toThrow(/invalid path separators/)
      expect(() => parseArtifactRef(makeRef('full\0.md'))).toThrow(/control characters/)
      expect(() => parseArtifactRef(makeRef('images//img.png'))).toThrow(/invalid path separators/)
    })

    it('rejects URLs and secrets inside ResultProducer or ArtifactRef', () => {
      expect(() =>
        parseResultProducer({
          providerId: 'official-v4',
          providerConfigId: 'mp_default',
          compatibilityKey: 'https://mineru.net/api/v4?key=secret',
        }),
      ).toThrow(/must not contain URLs/)

      expect(() =>
        parseArtifactRef({
          kind: 'markdown',
          relativePath: 'full.md',
          mediaType: 'text/markdown?sig=123',
          bytes: 100,
          sha256: SHA256_A,
        }),
      ).toThrow(/must not contain URLs/)
    })
  })


})
