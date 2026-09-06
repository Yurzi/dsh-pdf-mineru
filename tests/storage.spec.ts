/**
 * storage.spec.ts — Unit and integration tests for MinerU storage subsystem.
 *
 * Tests:
 *   - Path traversal prevention & ID boundary validation
 *   - ArtifactRef boundaries & escaping prevention
 *   - Process lock (active process conflict, stale PID cleanup, release safety)
 *   - ArtifactSink streaming, SHA-256 calculation, and byte limit enforcement
 *   - ResultRepository begin/commit, duplicate reuse, conflict quarantine
 *   - Cache hit validation, missing artifact detection, and corrupt cache quarantine
 *   - Staging TTL cleanup respecting active operations
 */

import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  asCacheKey,
  asFileId,
  asOperationId,
  asProviderConfigId,
  asResultId,
  createFileId,
  createOperationId,
  resultIdForCacheKey,
} from '../src/domain/ids.js'
import { MinerUError } from '../src/domain/errors.js'
import { CANONICAL_PARSE_REQUEST_SCHEMA_VERSION, type CanonicalParseRequest } from '../src/domain/request.js'
import type { ArtifactRef, MinerUResultManifest, ResultProducer } from '../src/domain/result.js'
import { computeCacheKey } from '../src/domain/cache-key.js'
import {
  ProcessLock,
  ResultRepository,
  StagingArtifactSink,
  StorageAccessGate,
  StoragePaths,
  defaultStorageRoot,
} from '../src/storage/index.js'

const tempRoots: string[] = []

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mineru-storage-test-'))
  tempRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(p => rm(p, { recursive: true, force: true }).catch(() => {})))
})

function sampleRequest(sourceSha256 = 'a'.repeat(64)): CanonicalParseRequest {
  const fileId = createFileId(sourceSha256)
  return {
    schemaVersion: CANONICAL_PARSE_REQUEST_SCHEMA_VERSION,
    files: [
      {
        fileId,
        name: 'sample.pdf',
        bytes: 1024,
        sha256: sourceSha256,
      },
    ],
    semantics: {
      model: 'pipeline',
      ocr: false,
      parseMethod: 'auto',
      language: 'ch',
      formula: true,
      table: true,
    },
    requiredArtifacts: ['markdown'],
  }
}

function sampleProducer(): ResultProducer {
  return {
    providerId: 'self-hosted-v2',
    providerConfigId: asProviderConfigId('mp_default'),
    compatibilityKey: 'self-hosted-v2:test-hash:v1:pipeline',
  }
}

describe('StoragePaths & Traversal Prevention', () => {
  it('derives safe POSIX layout and validates IDs', async () => {
    const root = await createTempRoot()
    const paths = new StoragePaths(root)

    const cacheKey = asCacheKey('f'.repeat(64))
    const opId = asOperationId('mo_op123')

    expect(paths.resultDir(cacheKey)).toBe(join(root, 'results', 'sha256', 'ff', 'f'.repeat(64)))
    expect(paths.manifestFile(cacheKey)).toBe(join(root, 'results', 'sha256', 'ff', 'f'.repeat(64), 'manifest.json'))
    expect(paths.stagingDir(opId)).toBe(join(root, 'staging', 'mo_op123'))
    expect(paths.processLockFile()).toBe(join(root, '.process.lock'))
  })

  it('rejects artifact relative paths that escape directory bounds', async () => {
    const root = await createTempRoot()
    const paths = new StoragePaths(root)
    const cacheKey = asCacheKey('e'.repeat(64))

    expect(() => paths.resolveArtifactPath(cacheKey, '../secret.txt')).toThrow(TypeError)
    expect(() => paths.resolveArtifactPath(cacheKey, 'files/../../secret.txt')).toThrow(TypeError)
    expect(() => paths.resolveArtifactPath(cacheKey, '/etc/passwd')).toThrow(TypeError)
    expect(() => paths.resolveArtifactPath(cacheKey, './relative')).toThrow(TypeError)

    const opId = asOperationId('mo_test')
    expect(() => paths.resolveStagingArtifactPath(opId, '../../evil')).toThrow(TypeError)
  })
})


describe('ArtifactSink & Streaming Writes', () => {
  it('writes artifacts with on-the-fly hashing and byte calculation', async () => {
    const root = await createTempRoot()
    const paths = new StoragePaths(root)
    const opId = createOperationId()
    const sink = new StagingArtifactSink(opId, paths)

    const fileId = asFileId('mf_test123456789012345678901234_0')

    // 1. Text markdown
    const mdRef = await sink.writeArtifact(fileId, 'markdown', '# Heading\n\nSome markdown content', {
      mediaType: 'text/markdown; charset=utf-8',
    })
    expect(mdRef.kind).toBe('markdown')
    expect(mdRef.relativePath).toBe(`files/${fileId}/full.md`)
    expect(mdRef.bytes).toBe(32)
    expect(mdRef.sha256).toMatch(/^[a-f0-9]{64}$/)

    // Verify physical file written
    const mdPhysical = paths.resolveStagingArtifactPath(opId, mdRef.relativePath)
    expect(await readFile(mdPhysical, 'utf8')).toBe('# Heading\n\nSome markdown content')

    // 2. Image with custom relative name
    const imageBuf = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
    const imgRef = await sink.writeArtifact(fileId, 'images', imageBuf, {
      mediaType: 'image/png',
      relativeName: 'images/figure1.png',
    })
    expect(imgRef.kind).toBe('images')
    expect(imgRef.relativePath).toBe(`files/${fileId}/images/figure1.png`)
    expect(imgRef.bytes).toBe(8)

    // 3. Node.js Readable stream for JSON
    const jsonStr = JSON.stringify({ pages: [1, 2, 3] })
    const layoutRef = await sink.writeArtifact(fileId, 'layout', Readable.from([jsonStr]), {
      mediaType: 'application/json',
    })
    expect(layoutRef.kind).toBe('layout')
    expect(layoutRef.bytes).toBe(jsonStr.length)
  })

  it('never overwrites an artifact path already finalized in staging', async () => {
    const root = await createTempRoot()
    const paths = new StoragePaths(root)
    const sink = new StagingArtifactSink(createOperationId(), paths)
    const fileId = asFileId('mf_duplicate123456789012345678_0')
    const first = await sink.writeArtifact(fileId, 'markdown', '# first', { mediaType: 'text/markdown' })
    await expect(sink.writeArtifact(fileId, 'markdown', '# other', { mediaType: 'text/markdown' })).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(paths.resolveStagingArtifactPath(sink.operationId, first.relativePath), 'utf8')).toBe('# first')
  })

  it('enforces maxBytes limit and unlinks partial file on overflow', async () => {
    const root = await createTempRoot()
    const paths = new StoragePaths(root)
    const opId = createOperationId()
    const sink = new StagingArtifactSink(opId, paths)

    const fileId = asFileId('mf_overflow1234567890123456789_0')
    const largeData = 'A'.repeat(5000)

    await expect(
      sink.writeArtifact(fileId, 'markdown', largeData, {
        mediaType: 'text/markdown',
        maxBytes: 100,
      }),
    ).rejects.toMatchObject({
      failure: { code: 'RESULT_TOO_LARGE' },
    })

    // Ensure partial file was unlinked
    const targetPath = paths.resolveStagingArtifactPath(opId, `files/${fileId}/full.md`)
    await expect(readFile(targetPath)).rejects.toThrow()
  })

  it('writes temporary artifacts for archive downloading', async () => {
    const root = await createTempRoot()
    const paths = new StoragePaths(root)
    const opId = createOperationId()
    const sink = new StagingArtifactSink(opId, paths)

    const temp = await sink.writeTemporary('download.zip', 'PK\x03\x04dummy-zip-content', 1000)
    expect(temp.path).toBe(join(paths.stagingTempDir(opId), 'download.zip'))
    expect(temp.bytes).toBe(21)
    expect(await readFile(temp.path, 'utf8')).toBe('PK\x03\x04dummy-zip-content')
  })
})

describe('ResultRepository (Transactions, Publishing, Cache Hits & Quarantine)', () => {
  it('commits transaction atomically, publishes result, and satisfies cache hits', async () => {
    const root = await createTempRoot()
    const paths = new StoragePaths(root)
    const repo = new ResultRepository(paths)

    const opId = createOperationId()
    const req = sampleRequest()
    const producer = sampleProducer()
    const tx = repo.beginTransaction(opId, req, producer)

    const file = req.files[0]!
    const mdRef = await tx.writeArtifact(file.fileId, 'markdown', '# Output Markdown', {
      mediaType: 'text/markdown; charset=utf-8',
    })

    const manifest = tx.buildManifest(file, [mdRef])
    const { resultId, cacheKey, manifest: committed } = await repo.commitTransaction(tx, manifest)

    expect(resultId).toBe(resultIdForCacheKey(cacheKey))
    expect(committed.cacheKey).toBe(cacheKey)

    // Staging directory was moved / cleaned
    await expect(stat(tx.stagingDir)).rejects.toThrow()

    // 1. Exact cache hit
    const hit = await repo.get(cacheKey, ['markdown'])
    expect(hit).toBeDefined()
    expect(hit?.id).toBe(resultId)
    expect(hit?.files[0]?.artifacts[0]?.relativePath).toBe(mdRef.relativePath)

    // Cancellation during post-read verification must not quarantine a valid cache.
    const cancelled = new AbortController()
    const cancelledRead = repo.get(cacheKey, ['markdown'], cancelled.signal)
    queueMicrotask(() => cancelled.abort())
    await expect(cancelledRead).rejects.toBeDefined()
    expect(await stat(paths.resultDir(cacheKey))).toBeDefined()
    expect(await repo.get(cacheKey, ['markdown'])).toBeDefined()

    // 2. Cache miss when requested artifact kind was not generated
    const missingArtifactHit = await repo.get(cacheKey, ['layout', 'markdown'])
    expect(missingArtifactHit).toBeUndefined()

    // 3. Absolute path resolution
    const fullPath = repo.resolveArtifactAbsolutePath(cacheKey, mdRef.relativePath)
    expect(await readFile(fullPath, 'utf8')).toBe('# Output Markdown')
  })

  it('rejects invalid JSON artifacts before publication', async () => {
    const root = await createTempRoot()
    const paths = new StoragePaths(root)
    const repo = new ResultRepository(paths)
    const base = sampleRequest()
    const request: CanonicalParseRequest = { ...base, requiredArtifacts: ['markdown', 'layout'] }
    const tx = repo.beginTransaction(createOperationId(), request, sampleProducer())
    const file = request.files[0]!
    const markdown = await tx.writeArtifact(file.fileId, 'markdown', '# valid', { mediaType: 'text/markdown' })
    const layout = await tx.writeArtifact(file.fileId, 'layout', '{invalid', { mediaType: 'application/json' })
    const manifest = tx.buildManifest(file, [markdown, layout])
    await expect(repo.commitTransaction(tx, manifest)).rejects.toMatchObject({ failure: { code: 'CACHE_CORRUPT' } })
    await expect(stat(paths.resultDir(manifest.cacheKey))).rejects.toThrow()
  })

  it('handles duplicate commit idempotently by reusing existing published result', async () => {
    const root = await createTempRoot()
    const paths = new StoragePaths(root)
    const repo = new ResultRepository(paths)

    const req = sampleRequest()
    const producer = sampleProducer()
    const file = req.files[0]!

    // First commit
    const op1 = createOperationId()
    const tx1 = repo.beginTransaction(op1, req, producer)
    const art1 = await tx1.writeArtifact(file.fileId, 'markdown', '# Content Same', {
      mediaType: 'text/markdown',
    })
    const manifest1 = tx1.buildManifest(file, [art1])
    const res1 = await repo.commitTransaction(tx1, manifest1)

    // Second commit with identical request and content
    const op2 = createOperationId()
    const tx2 = repo.beginTransaction(op2, req, producer)
    const art2 = await tx2.writeArtifact(file.fileId, 'markdown', '# Content Same', {
      mediaType: 'text/markdown',
    })
    const manifest2 = tx2.buildManifest(file, [art2])
    const res2 = await repo.commitTransaction(tx2, manifest2)

    expect(res2.resultId).toBe(res1.resultId)
    expect(res2.cacheKey).toBe(res1.cacheKey)
  })

  it('keeps the first valid immutable publication when provider bytes differ', async () => {
    const root = await createTempRoot()
    const paths = new StoragePaths(root)
    const repo = new ResultRepository(paths)

    const req = sampleRequest()
    const producer = sampleProducer()
    const file = req.files[0]!

    // First commit
    const op1 = createOperationId()
    const tx1 = repo.beginTransaction(op1, req, producer)
    const art1 = await tx1.writeArtifact(file.fileId, 'markdown', '# Content One', {
      mediaType: 'text/markdown',
    })
    const manifest1 = tx1.buildManifest(file, [art1])
    await repo.commitTransaction(tx1, manifest1)

    // Same bytes under a different display name still share cache identity.
    const renamedRequest: CanonicalParseRequest = {
      ...req,
      files: [{ ...file, name: 'renamed-copy.pdf' }],
    }
    const renamedFile = renamedRequest.files[0]!
    const op2 = createOperationId()
    const tx2 = repo.beginTransaction(op2, renamedRequest, producer)
    const art2 = await tx2.writeArtifact(renamedFile.fileId, 'markdown', '# Content DIFFERENT', {
      mediaType: 'text/markdown',
    })
    const manifest2 = tx2.buildManifest(renamedFile, [art2])

    const reused = await repo.commitTransaction(tx2, manifest2)
    expect(reused.manifest.files[0]!.artifacts[0]!.sha256).toBe(art1.sha256)
    await expect(stat(tx2.stagingDir)).rejects.toThrow()
  })

  it('blocks direct published-result quarantine while a shared reader lease is active', async () => {
    const root = await createTempRoot()
    const paths = new StoragePaths(root)
    const lock = new ProcessLock(paths)
    const repo = new ResultRepository(paths, {}, lock)
    const gate = new StorageAccessGate({ paths, lock })
    const request = sampleRequest()
    const file = request.files[0]!
    const tx = repo.beginTransaction(createOperationId(), request, sampleProducer())
    const artifact = await tx.writeArtifact(file.fileId, 'markdown', '# held', { mediaType: 'text/markdown' })
    const published = await repo.commitTransaction(tx, tx.buildManifest(file, [artifact]))

    let release!: () => void
    let entered!: () => void
    const ready = new Promise<void>(resolve => { entered = resolve })
    const held = gate.runShared(async () => {
      entered()
      await new Promise<void>(resolve => { release = resolve })
    })
    await ready
    await expect(repo.quarantine(paths.resultDir(published.cacheKey)))
      .rejects.toMatchObject({ failure: { code: 'STORAGE_LOCKED' } })
    await expect(stat(paths.resultDir(published.cacheKey))).resolves.toBeDefined()
    release()
    await held
  })

  it('rejects a symlinked result ancestor before creating cache prefixes outside storage', async () => {
    const root = await createTempRoot()
    const outside = await createTempRoot()
    const paths = new StoragePaths(root)
    await mkdir(join(root, 'results'))
    await symlink(outside, paths.resultsDir())
    const repo = new ResultRepository(paths)
    const request = sampleRequest()
    const file = request.files[0]!
    const tx = repo.beginTransaction(createOperationId(), request, sampleProducer())
    const artifact = await tx.writeArtifact(file.fileId, 'markdown', '# safe', { mediaType: 'text/markdown' })
    const manifest = tx.buildManifest(file, [artifact])

    await expect(repo.commitTransaction(tx, manifest))
      .rejects.toMatchObject({ failure: { code: 'CACHE_CORRUPT' } })
    await expect(stat(join(outside, manifest.cacheKey.slice(0, 2)))).rejects.toThrow()
  })

  it('reports corrupt cache without mutating published data', async () => {
    const root = await createTempRoot()
    const paths = new StoragePaths(root)
    const repo = new ResultRepository(paths)

    const req = sampleRequest()
    const producer = sampleProducer()
    const file = req.files[0]!

    const op = createOperationId()
    const tx = repo.beginTransaction(op, req, producer)
    const art = await tx.writeArtifact(file.fileId, 'markdown', '# Markdown to Corrupt', {
      mediaType: 'text/markdown',
    })
    const manifest = tx.buildManifest(file, [art])
    const { cacheKey } = await repo.commitTransaction(tx, manifest)

    // Corrupt the cache: make the immutable test fixture writable, then delete its markdown.
    const physicalPath = paths.resolveArtifactPath(cacheKey, art.relativePath)
    await chmod(paths.fileDir(cacheKey, file.fileId), 0o755)
    await chmod(physicalPath, 0o644)
    await rm(physicalPath)

    await expect(repo.get(cacheKey)).rejects.toMatchObject({ failure: { code: 'CACHE_CORRUPT' } })
    await expect(stat(paths.resultDir(cacheKey))).resolves.toBeDefined()
  })

  it('detects same-size SHA-256 corruption without implicit quarantine', async () => {
    const root = await createTempRoot()
    const paths = new StoragePaths(root)
    const repo = new ResultRepository(paths)
    const request = sampleRequest()
    const tx = repo.beginTransaction(createOperationId(), request, sampleProducer())
    const file = request.files[0]!
    const artifact = await tx.writeArtifact(file.fileId, 'markdown', 'same-size-A', { mediaType: 'text/markdown' })
    const manifest = tx.buildManifest(file, [artifact])
    await repo.commitTransaction(tx, manifest)
    const physical = paths.resolveArtifactPath(manifest.cacheKey, artifact.relativePath)
    await chmod(paths.fileDir(manifest.cacheKey, file.fileId), 0o755)
    await chmod(physical, 0o644)
    await writeFile(physical, 'same-size-B')
    await expect(repo.get(manifest.cacheKey)).rejects.toMatchObject({ failure: { code: 'CACHE_CORRUPT' } })
    await expect(stat(paths.resultDir(manifest.cacheKey))).resolves.toBeDefined()
  })

  it('rejects unmanaged quarantine sources and never follows staging symlinks', async () => {
    const root = await createTempRoot()
    const paths = new StoragePaths(root)
    const repo = new ResultRepository(paths)
    const outside = join(root, 'outside-managed-storage')
    await mkdir(outside, { recursive: true })
    await writeFile(join(outside, 'preserve.txt'), 'preserve')

    await expect(repo.quarantine(outside)).rejects.toThrow(/complete staging operation or published result/)

    const linkedOperation = createOperationId()
    await mkdir(paths.stagingDir(), { recursive: true })
    await symlink(outside, paths.stagingDir(linkedOperation))
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(await repo.cleanupStaging(1)).toBe(0)
    expect(await readFile(join(outside, 'preserve.txt'), 'utf8')).toBe('preserve')
    expect((await stat(paths.stagingDir(linkedOperation))).isDirectory()).toBe(true)
  })

  it('rejects oversized manifests without loading them unboundedly', async () => {
    const root = await createTempRoot()
    const paths = new StoragePaths(root)
    const repo = new ResultRepository(paths, { maxManifestBytes: 128 })
    const request = sampleRequest()
    const tx = repo.beginTransaction(createOperationId(), request, sampleProducer())
    const file = request.files[0]!
    const artifact = await tx.writeArtifact(file.fileId, 'markdown', '# bounded manifest', { mediaType: 'text/markdown' })
    const manifest = tx.buildManifest(file, [artifact])
    await expect(repo.commitTransaction(tx, manifest)).rejects.toMatchObject({
      failure: { code: 'RESULT_TOO_LARGE' },
    })
    await expect(stat(paths.stagingDir(tx.operationId))).rejects.toThrow()
    await expect(stat(paths.resultDir(manifest.cacheKey))).rejects.toThrow()
  })

  it('cleans up expired staging directories while preserving active operations', async () => {
    const root = await createTempRoot()
    const paths = new StoragePaths(root)
    const repo = new ResultRepository(paths)

    const activeOp = createOperationId()
    const staleOp = createOperationId()

    const activeTx = repo.beginTransaction(activeOp, sampleRequest(), sampleProducer())
    const staleTx = repo.beginTransaction(staleOp, sampleRequest(), sampleProducer())

    const file = sampleRequest().files[0]!
    await activeTx.writeArtifact(file.fileId, 'markdown', '# Active', { mediaType: 'text/markdown' })
    await staleTx.writeArtifact(file.fileId, 'markdown', '# Stale', { mediaType: 'text/markdown' })

    // Age the stale staging directory by 2 hours
    const pastTime = new Date(Date.now() - 2 * 3600 * 1000)
    await utimes(staleTx.stagingDir, pastTime, pastTime)

    const activeSet = new Set<string>([activeOp])
    const cleanedCount = await repo.cleanupStaging(3600 * 1000, activeSet)
    expect(cleanedCount).toBe(1)

    // Stale op directory deleted
    await expect(stat(staleTx.stagingDir)).rejects.toThrow()

    // Active op directory preserved
    expect(await stat(activeTx.stagingDir)).toBeDefined()
  })
})
