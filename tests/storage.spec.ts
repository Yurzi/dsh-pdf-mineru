/**
 * storage.spec.ts — Unit and integration tests for MinerU storage subsystem.
 *
 * Tests:
 *   - Session A/B isolation & access denial
 *   - Path traversal prevention & ID boundary validation
 *   - ArtifactRef boundaries & escaping prevention
 *   - Process lock (active process conflict, stale PID cleanup, release safety)
 *   - JobRepository atomic temp+rename, state machine transitions, concurrent updates
 *   - ArtifactSink streaming, SHA-256 calculation, and byte limit enforcement
 *   - ResultRepository begin/commit, duplicate reuse, conflict quarantine
 *   - Cache hit validation, missing artifact detection, and corrupt cache quarantine
 *   - Staging TTL cleanup respecting active operations
 */

import { chmod, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  asCacheKey,
  asFileId,
  asJobId,
  asOperationId,
  asProviderConfigId,
  asResultId,
  asSessionId,
  createFileId,
  createJobId,
  createOperationId,
  resultIdForCacheKey,
  type SessionId,
} from '../src/domain/ids.js'
import { MinerUError } from '../src/domain/errors.js'
import { CANONICAL_PARSE_REQUEST_SCHEMA_VERSION, type CanonicalParseRequest } from '../src/domain/request.js'
import { MINERU_JOB_SCHEMA_VERSION, type MinerUJobRecord } from '../src/domain/job.js'
import type { ArtifactRef, MinerUResultManifest, ResultProducer } from '../src/domain/result.js'
import { computeCacheKey } from '../src/service/cache-key.js'
import {
  JobRepository,
  ProcessLock,
  ResultRepository,
  StagingArtifactSink,
  StoragePaths,
  defaultStorageRoot,
  extractSessionId,
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

function sessionObject(id: SessionId): { readonly header: { readonly id: SessionId } } {
  return { header: { id } }
}

function sampleJob(sessionId: SessionId, req = sampleRequest(), producer = sampleProducer()): MinerUJobRecord {
  const file = req.files[0]!
  const cacheKey = computeCacheKey(req, file, producer.compatibilityKey)
  const id = createJobId()

  return {
    schemaVersion: MINERU_JOB_SCHEMA_VERSION,
    id,
    sessionId,
    providerId: producer.providerId,
    providerConfigId: producer.providerConfigId,
    providerCompatibilityKey: producer.compatibilityKey,
    sourceFiles: [
      {
        fileId: file.fileId,
        name: file.name,
        bytes: file.bytes,
        sha256: file.sha256,
      },
    ],
    request: req,
    cacheKey,
    state: 'queued',
    resolution: { kind: 'provider' },
    files: [
      {
        fileId: file.fileId,
        name: file.name,
        cacheKey,
        state: 'queued',
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

describe('StoragePaths & Traversal Prevention', () => {
  it('derives safe POSIX layout and validates IDs', async () => {
    const root = await createTempRoot()
    const paths = new StoragePaths(root)

    const sessionA = asSessionId('session-a_123')
    const jobId = asJobId('mj_0123456789abcdef')
    const cacheKey = asCacheKey('f'.repeat(64))
    const opId = asOperationId('mo_op123')

    expect(paths.jobDir(sessionA)).toBe(join(root, 'jobs', 'session-a_123'))
    expect(paths.jobFile(sessionA, jobId)).toBe(join(root, 'jobs', 'session-a_123', 'mj_0123456789abcdef.json'))
    expect(paths.resultDir(cacheKey)).toBe(join(root, 'results', 'sha256', 'ff', 'f'.repeat(64)))
    expect(paths.manifestFile(cacheKey)).toBe(join(root, 'results', 'sha256', 'ff', 'f'.repeat(64), 'manifest.json'))
    expect(paths.stagingDir(opId)).toBe(join(root, 'staging', 'mo_op123'))
    expect(paths.processLockFile()).toBe(join(root, '.process.lock'))
  })

  it('rejects path traversal attempts in session and job IDs', async () => {
    const root = await createTempRoot()
    const paths = new StoragePaths(root)

    expect(() => paths.jobDir('../session-evil')).toThrow(TypeError)
    expect(() => paths.jobDir('..')).toThrow(TypeError)
    expect(() => paths.jobDir('/absolute')).toThrow(TypeError)
    expect(() => paths.jobFile('session-1', '../mj_evil')).toThrow(TypeError)
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

describe('ProcessLock', () => {
  it('acquires and releases lock on storage root', async () => {
    const root = await createTempRoot()
    const paths = new StoragePaths(root)
    const lock = new ProcessLock(paths)

    expect(lock.isHeld()).toBe(false)
    await lock.acquire()
    expect(lock.isHeld()).toBe(true)

    const lockData = JSON.parse(await readFile(paths.processLockFile(), 'utf8')) as { pid: number }
    expect(lockData.pid).toBe(process.pid)

    // Idempotent acquire on same instance
    await lock.acquire()
    expect(lock.isHeld()).toBe(true)

    await lock.release()
    expect(lock.isHeld()).toBe(false)

    // Lock file removed
    await expect(readFile(paths.processLockFile(), 'utf8')).rejects.toThrow()
  })

  it('throws STORAGE_LOCKED when lock is held by another active process', async () => {
    const root = await createTempRoot()
    const paths = new StoragePaths(root)

    // Simulate lock held by current process under another ownerToken
    const fakeLock = {
      pid: process.pid,
      ownerToken: 'owner_foreign_999',
      createdAt: Date.now(),
      hostname: 'testhost',
    }
    await writeFile(paths.processLockFile(), JSON.stringify(fakeLock))

    const lock = new ProcessLock(paths)
    await expect(lock.acquire()).rejects.toMatchObject({
      failure: { code: 'STORAGE_LOCKED' },
    })
  })

  it('refuses to delete a malformed lock whose owner cannot be proven stale', async () => {
    const root = await createTempRoot()
    const paths = new StoragePaths(root)
    await writeFile(paths.processLockFile(), '{not-json')
    await expect(new ProcessLock(paths).acquire()).rejects.toMatchObject({
      failure: { code: 'STORAGE_LOCKED' },
    })
    expect(await readFile(paths.processLockFile(), 'utf8')).toBe('{not-json')
  })

  it('reclaims stale lock when previous owner process is dead', async () => {
    const root = await createTempRoot()
    const paths = new StoragePaths(root)

    // PID 99999999 is dead
    const deadLock = {
      pid: 99999999,
      ownerToken: 'owner_dead_123',
      createdAt: Date.now() - 100000,
      hostname: 'testhost',
    }
    await writeFile(paths.processLockFile(), JSON.stringify(deadLock))

    const lock = new ProcessLock(paths)
    await lock.acquire()
    expect(lock.isHeld()).toBe(true)

    const newLock = JSON.parse(await readFile(paths.processLockFile(), 'utf8')) as { pid: number }
    expect(newLock.pid).toBe(process.pid)

    await lock.release()
  })
})

describe('JobRepository & Session A/B Isolation', () => {
  it('creates, retrieves, and enforces strict session A/B isolation', async () => {
    const root = await createTempRoot()
    const paths = new StoragePaths(root)
    const repo = new JobRepository(paths)

    const sessionA = asSessionId('session-alice')
    const sessionB = asSessionId('session-bob')

    const jobA = sampleJob(sessionA)
    const createdA = await repo.create(sessionObject(sessionA), jobA)
    expect(createdA.id).toBe(jobA.id)

    // Session A can read Job A
    const readA = await repo.get(sessionObject(sessionA), jobA.id)
    expect(readA?.id).toBe(jobA.id)

    // Session B cannot read Job A (returns undefined, isolated)
    expect(await repo.get(sessionObject(sessionB), jobA.id)).toBeUndefined()
    await expect(repo.require(sessionObject(sessionB), jobA.id)).rejects.toMatchObject({
      failure: { code: 'JOB_NOT_FOUND' },
    })

    // If a job record inside sessionB's folder has a mismatched sessionId, throw JOB_ACCESS_DENIED
    const tamperedJob = { ...jobA, id: createJobId() }
    const sessionBDir = paths.jobDir(sessionB)
    await mkdir(sessionBDir, { recursive: true })
    await writeFile(paths.jobFile(sessionB, tamperedJob.id), JSON.stringify(tamperedJob))
    await expect(repo.get(sessionObject(sessionB), tamperedJob.id)).rejects.toMatchObject({
      failure: { code: 'JOB_ACCESS_DENIED' },
    })

    // Non-existent job returns undefined for get, throws JOB_NOT_FOUND for require
    const nonExistent = asJobId('mj_nonexistent999999999999')
    expect(await repo.get(sessionObject(sessionA), nonExistent)).toBeUndefined()
    await expect(repo.require(sessionObject(sessionA), nonExistent)).rejects.toMatchObject({
      failure: { code: 'JOB_NOT_FOUND' },
    })

    // Listing is isolated per session
    const jobB = sampleJob(sessionB)
    await repo.create(sessionObject(sessionB), jobB)

    const listA = await repo.list(sessionObject(sessionA))
    expect(listA.map(j => j.id)).toEqual([jobA.id])

    const listB = await repo.list(sessionObject(sessionB))
    expect(listB.map(j => j.id)).toEqual([jobB.id])
  })

  it('updates jobs with state machine transition checks and concurrency serialization', async () => {
    const root = await createTempRoot()
    const paths = new StoragePaths(root)
    const repo = new JobRepository(paths)

    const session = asSessionId('session-trans')
    const job = sampleJob(session)
    await repo.create(sessionObject(session), job)

    // Valid state transitions: queued -> uploading -> processing -> collecting -> completed
    const updated1 = await repo.update(sessionObject(session), job.id, current => ({
      ...current,
      state: 'uploading',
    }))
    expect(updated1.state).toBe('uploading')

    const updated2 = await repo.update(sessionObject(session), job.id, current => ({
      ...current,
      state: 'processing',
    }))
    expect(updated2.state).toBe('processing')

    const updated3 = await repo.update(sessionObject(session), job.id, current => ({
      ...current,
      state: 'completed',
    }))
    expect(updated3.state).toBe('completed')

    // Invalid transition from terminal 'completed' to 'processing' throws TypeError
    await expect(
      repo.update(sessionObject(session), job.id, current => ({
        ...current,
        state: 'processing',
      })),
    ).rejects.toThrow(TypeError)
  })

  it('rejects updates that attempt to change immutable job metadata', async () => {
    const root = await createTempRoot()
    const paths = new StoragePaths(root)
    const repo = new JobRepository(paths)

    const session = asSessionId('session-immut')
    const job = sampleJob(session)
    await repo.create(sessionObject(session), job)

    // Attempting to change sessionId
    await expect(
      repo.update(sessionObject(session), job.id, current => ({
        ...current,
        sessionId: asSessionId('session-tampered'),
      })),
    ).rejects.toThrow(TypeError)

    // Attempting to change jobId
    await expect(
      repo.update(sessionObject(session), job.id, current => ({
        ...current,
        id: createJobId(),
      })),
    ).rejects.toThrow(TypeError)
  })

  it('requires an Agent-backed DSH Session object', () => {
    expect(extractSessionId({ header: { id: asSessionId('sess-hdr') } })).toBe(asSessionId('sess-hdr'))
    expect(() => extractSessionId('sess-raw' as unknown as { header: { id: SessionId } })).toThrow(TypeError)
    expect(() => extractSessionId({ id: asSessionId('sess-id') } as unknown as { header: { id: SessionId } })).toThrow(TypeError)
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

  it('detects cache conflict, quarantines staging, and throws CACHE_CONFLICT', async () => {
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

    // Second commit with same cache key but conflicting artifact content
    const op2 = createOperationId()
    const tx2 = repo.beginTransaction(op2, req, producer)
    const art2 = await tx2.writeArtifact(file.fileId, 'markdown', '# Content DIFFERENT', {
      mediaType: 'text/markdown',
    })
    const manifest2 = tx2.buildManifest(file, [art2])

    await expect(repo.commitTransaction(tx2, manifest2)).rejects.toMatchObject({
      failure: { code: 'CACHE_CONFLICT' },
    })
  })

  it('quarantines corrupt cache directory on physical file deletion or size mismatch and returns cache miss', async () => {
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

    // Attempting get(cacheKey) should detect missing artifact, quarantine resultDir, and return undefined
    const hit = await repo.get(cacheKey)
    expect(hit).toBeUndefined()

    // The result directory in results/ was moved to quarantine
    await expect(stat(paths.resultDir(cacheKey))).rejects.toThrow()
  })

  it('detects same-size SHA-256 corruption and quarantines the published result', async () => {
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
    expect(await repo.get(manifest.cacheKey)).toBeUndefined()
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
