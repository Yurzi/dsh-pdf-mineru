import { lstat, lutimes, mkdir, readFile, readdir, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { asCacheKey, asFileId, asOperationId, createOperationId, resultIdForCacheKey } from '../src/domain/ids.js'
import { StagingArtifactSink } from '../src/storage/artifact-sink.js'
import { StorageAccessGate } from '../src/storage/access-gate.js'
import { StoragePaths } from '../src/storage/paths.js'
import { holdSharedAccess, publish, sampleProducer, sampleRequest, storageFixture, tempRoot } from './support/storage-fixtures.js'

// Pass-through fs/promises with one injectable rename fault for the publication target.
const renameFault = vi.hoisted(() => ({ target: undefined as string | undefined, code: 'EXDEV' }))
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: async (from: Parameters<typeof actual.rename>[0], to: Parameters<typeof actual.rename>[1]) => {
      if (renameFault.target !== undefined && String(to) === renameFault.target) {
        throw Object.assign(new Error('injected ' + renameFault.code), { code: renameFault.code })
      }
      return await actual.rename(from, to)
    },
  }
})
afterEach(() => { renameFault.target = undefined })

const past = new Date(Date.now() - 2 * 3600 * 1000)

describe('StoragePaths', () => {
  it('derives the persisted POSIX layout', async () => {
    const root = await tempRoot()
    const paths = new StoragePaths(root)
    const key = asCacheKey('f'.repeat(64))
    expect(paths.resultDir(key)).toBe(join(root, 'results', 'sha256', 'ff', key))
    expect(paths.manifestFile(key)).toBe(join(root, 'results', 'sha256', 'ff', key, 'manifest.json'))
    expect(paths.stagingDir(asOperationId('mo_op123'))).toBe(join(root, 'staging', 'mo_op123'))
    expect(paths.processLockFile()).toBe(join(root, '.process.lock'))
  })

  it.each(['../secret.txt', 'files/../../secret.txt', '/etc/passwd', './relative'])(
    'rejects artifact path %s that escapes its result or staging directory', async relativePath => {
      const paths = new StoragePaths(await tempRoot())
      expect(() => paths.resolveArtifactPath(asCacheKey('e'.repeat(64)), relativePath)).toThrow(TypeError)
      expect(() => paths.resolveStagingArtifactPath(asOperationId('mo_test'), relativePath)).toThrow(TypeError)
    },
  )
})

describe('StagingArtifactSink', () => {
  const fileId = asFileId('mf_test123456789012345678901234_0')

  it('streams text, binary and Readable inputs with hashing and byte accounting', async () => {
    const paths = new StoragePaths(await tempRoot())
    const sink = new StagingArtifactSink(createOperationId(), paths)
    const markdown = await sink.writeArtifact(fileId, 'markdown', '# Heading\n\nSome markdown content', { mediaType: 'text/markdown; charset=utf-8' })
    expect(markdown).toMatchObject({ kind: 'markdown', relativePath: `files/${fileId}/full.md`, bytes: 32, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(await readFile(paths.resolveStagingArtifactPath(sink.operationId, markdown.relativePath), 'utf8')).toBe('# Heading\n\nSome markdown content')
    const image = await sink.writeArtifact(fileId, 'images', Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), { mediaType: 'image/png', relativeName: 'images/figure1.png' })
    expect(image).toMatchObject({ relativePath: `files/${fileId}/images/figure1.png`, bytes: 8 })
    const json = JSON.stringify({ pages: [1, 2, 3] })
    expect(await sink.writeArtifact(fileId, 'layout', Readable.from([json]), { mediaType: 'application/json' })).toMatchObject({ kind: 'layout', bytes: json.length })
  })

  it('never overwrites an artifact path already finalized in staging', async () => {
    const paths = new StoragePaths(await tempRoot())
    const sink = new StagingArtifactSink(createOperationId(), paths)
    const first = await sink.writeArtifact(fileId, 'markdown', '# first', { mediaType: 'text/markdown' })
    await expect(sink.writeArtifact(fileId, 'markdown', '# other', { mediaType: 'text/markdown' })).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(paths.resolveStagingArtifactPath(sink.operationId, first.relativePath), 'utf8')).toBe('# first')
  })

  it('enforces maxBytes and unlinks the partial file', async () => {
    const paths = new StoragePaths(await tempRoot())
    const sink = new StagingArtifactSink(createOperationId(), paths)
    await expect(sink.writeArtifact(fileId, 'markdown', 'A'.repeat(5000), { mediaType: 'text/markdown', maxBytes: 100 }))
      .rejects.toMatchObject({ failure: { code: 'RESULT_TOO_LARGE' } })
    await expect(stat(paths.resolveStagingArtifactPath(sink.operationId, `files/${fileId}/full.md`))).rejects.toThrow()
  })

  it('writes bounded temporary artifacts inside the operation temp directory', async () => {
    const paths = new StoragePaths(await tempRoot())
    const sink = new StagingArtifactSink(createOperationId(), paths)
    const temp = await sink.writeTemporary('download.zip', 'PK\x03\x04dummy-zip-content', 1000)
    expect(temp).toMatchObject({ path: join(paths.stagingTempDir(sink.operationId), 'download.zip'), bytes: 21 })
  })
})

describe('ResultRepository publication and cache reads', () => {
  it('publishes atomically, serves cache hits and survives a cancelled verification', async () => {
    const { paths, results } = await storageFixture()
    const request = sampleRequest()
    const file = request.files[0]!
    const tx = results.beginTransaction(createOperationId(), request, sampleProducer())
    const markdown = await tx.writeArtifact(file.fileId, 'markdown', '# Output Markdown', { mediaType: 'text/markdown; charset=utf-8' })
    const { resultId, cacheKey, manifest } = await results.commitTransaction(tx, tx.buildManifest(file, [markdown]))
    expect(resultId).toBe(resultIdForCacheKey(cacheKey))
    expect(manifest.cacheKey).toBe(cacheKey)
    await expect(stat(tx.stagingDir)).rejects.toThrow()

    expect(await results.get(cacheKey, ['markdown'])).toMatchObject({ id: resultId, files: [{ artifacts: [{ relativePath: markdown.relativePath }] }] })
    // Cancellation during post-read verification must not quarantine a valid cache.
    const cancelled = new AbortController()
    const read = results.get(cacheKey, ['markdown'], cancelled.signal)
    queueMicrotask(() => cancelled.abort())
    await expect(read).rejects.toBeDefined()
    expect(await results.get(cacheKey, ['markdown'])).toBeDefined()
    // A requested artifact kind that was never generated is a miss, not corruption.
    expect(await results.get(cacheKey, ['layout', 'markdown'])).toBeUndefined()
    expect(await readFile(results.resolveArtifactAbsolutePath(cacheKey, markdown.relativePath), 'utf8')).toBe('# Output Markdown')
    expect(await readdir(paths.root)).not.toContain('quarantine')
  })

  it('rejects invalid JSON artifacts before publication', async () => {
    const { paths, results } = await storageFixture()
    const request = sampleRequest(undefined, { requiredArtifacts: ['markdown', 'layout'] })
    const file = request.files[0]!
    const tx = results.beginTransaction(createOperationId(), request, sampleProducer())
    const markdown = await tx.writeArtifact(file.fileId, 'markdown', '# valid', { mediaType: 'text/markdown' })
    const layout = await tx.writeArtifact(file.fileId, 'layout', '{invalid', { mediaType: 'application/json' })
    const manifest = tx.buildManifest(file, [markdown, layout])
    await expect(results.commitTransaction(tx, manifest)).rejects.toMatchObject({ failure: { code: 'CACHE_CORRUPT' } })
    await expect(stat(paths.resultDir(manifest.cacheKey))).rejects.toThrow()
  })

  it.each([
    ['identical bytes', '# Content One', 'sample.pdf'],
    ['different provider bytes under a renamed source', '# Content DIFFERENT', 'renamed-copy.pdf'],
  ])('reuses the first immutable publication for %s', async (_case, content, name) => {
    const { results } = await storageFixture()
    const first = await publish(results, undefined, '# Content One')
    const base = sampleRequest()
    const request = { ...base, files: [{ ...base.files[0]!, name }] }
    const file = request.files[0]!
    const tx = results.beginTransaction(createOperationId(), request, sampleProducer())
    const artifact = await tx.writeArtifact(file.fileId, 'markdown', content, { mediaType: 'text/markdown' })
    const reused = await results.commitTransaction(tx, tx.buildManifest(file, [artifact]))
    expect(reused.cacheKey).toBe(first.cacheKey)
    expect(reused.manifest.files[0]!.artifacts[0]!.sha256).toBe(first.manifest.files[0]!.artifacts[0]!.sha256)
    await expect(stat(tx.stagingDir)).rejects.toThrow()
  })

  it('fails publication on EXDEV without a copy fallback and keeps the staged tree out of results', async () => {
    const { paths, results } = await storageFixture()
    const request = sampleRequest()
    const file = request.files[0]!
    const tx = results.beginTransaction(createOperationId(), request, sampleProducer())
    const artifact = await tx.writeArtifact(file.fileId, 'markdown', '# cross-device', { mediaType: 'text/markdown' })
    const manifest = tx.buildManifest(file, [artifact])
    renameFault.target = paths.resultDir(manifest.cacheKey)
    await expect(results.commitTransaction(tx, manifest)).rejects.toMatchObject({ code: 'EXDEV' })
    renameFault.target = undefined
    await expect(stat(paths.resultDir(manifest.cacheKey))).rejects.toThrow()
    await expect(stat(tx.stagingDir)).rejects.toThrow()
    expect(await results.get(manifest.cacheKey)).toBeUndefined()
    // The failed staging tree is isolated for inspection, never published by copying.
    expect(await readdir(paths.quarantineDir())).toHaveLength(1)
  })

  it('rejects a symlinked result ancestor before creating cache prefixes outside storage', async () => {
    const { root, paths, results } = await storageFixture()
    const outside = await tempRoot()
    await mkdir(join(root, 'results'))
    await symlink(outside, paths.resultsDir())
    const request = sampleRequest()
    const file = request.files[0]!
    const tx = results.beginTransaction(createOperationId(), request, sampleProducer())
    const artifact = await tx.writeArtifact(file.fileId, 'markdown', '# safe', { mediaType: 'text/markdown' })
    const manifest = tx.buildManifest(file, [artifact])
    await expect(results.commitTransaction(tx, manifest)).rejects.toMatchObject({ failure: { code: 'CACHE_CORRUPT' } })
    await expect(stat(join(outside, manifest.cacheKey.slice(0, 2)))).rejects.toThrow()
  })

  it('rejects oversized manifests and removes their staging tree', async () => {
    const { paths, results } = await storageFixture({ repository: { maxManifestBytes: 128 } })
    const request = sampleRequest()
    const file = request.files[0]!
    const tx = results.beginTransaction(createOperationId(), request, sampleProducer())
    const artifact = await tx.writeArtifact(file.fileId, 'markdown', '# bounded manifest', { mediaType: 'text/markdown' })
    const manifest = tx.buildManifest(file, [artifact])
    await expect(results.commitTransaction(tx, manifest)).rejects.toMatchObject({ failure: { code: 'RESULT_TOO_LARGE' } })
    await expect(stat(tx.stagingDir)).rejects.toThrow()
    await expect(stat(paths.resultDir(manifest.cacheKey))).rejects.toThrow()
  })

  it.each([
    ['a missing artifact', async (path: string) => { await rm(path) }],
    ['same-size SHA-256 corruption', async (path: string) => { await writeFile(path, '# PUBLISHED') }],
  ])('reports %s as CACHE_CORRUPT without implicit quarantine', async (_case, corrupt) => {
    const { paths, results } = await storageFixture()
    const published = await publish(results, undefined, '# published')
    await corrupt(paths.resolveArtifactPath(published.cacheKey, published.artifactPath))
    await expect(results.get(published.cacheKey)).rejects.toMatchObject({ failure: { code: 'CACHE_CORRUPT' } })
    await expect(stat(paths.resultDir(published.cacheKey))).resolves.toBeDefined()
  })
})

describe('ResultRepository scoped mutation', () => {
  it('blocks scoped published-result quarantine while a shared reader lease is active', async () => {
    const { paths, lock, results } = await storageFixture()
    const published = await publish(results)
    const release = await holdSharedAccess(new StorageAccessGate({ paths, lock }))
    try {
      await expect(lock.withLock(scope => results.quarantineScoped(lock, scope, paths.resultDir(published.cacheKey))))
        .rejects.toMatchObject({ failure: { code: 'STORAGE_LOCKED' } })
    } finally { await release() }
    await expect(stat(paths.resultDir(published.cacheKey))).resolves.toBeDefined()
  })

  it('rejects unmanaged quarantine sources and never follows staging symlinks', async () => {
    const { root, paths, lock, results } = await storageFixture()
    const outside = join(root, 'outside-managed-storage')
    await mkdir(outside)
    await writeFile(join(outside, 'preserve.txt'), 'preserve')
    await lock.initialize()
    await expect(lock.withLock(scope => results.quarantineScoped(lock, scope, outside)))
      .rejects.toThrow(/complete staging operation or published result/)

    const linked = paths.stagingDir(createOperationId())
    await mkdir(paths.stagingDir(), { recursive: true })
    await symlink(outside, linked)
    await lutimes(linked, past, past)
    expect(await results.cleanupStaging(3600 * 1000)).toBe(0)
    expect(await readFile(join(outside, 'preserve.txt'), 'utf8')).toBe('preserve')
    expect((await stat(linked)).isDirectory()).toBe(true)
  })

  it('does not traverse a symlinked staging root', async () => {
    const { root, results } = await storageFixture()
    const outside = await tempRoot()
    await writeFile(join(outside, 'preserve.txt'), 'preserve')
    await symlink(outside, join(root, 'staging'))
    expect(await results.cleanupStaging(1)).toBe(0)
    expect(await readFile(join(outside, 'preserve.txt'), 'utf8')).toBe('preserve')
    expect((await lstat(join(root, 'staging'))).isSymbolicLink()).toBe(true)
  })

  it('cleans up expired staging directories while preserving active operations', async () => {
    const { results } = await storageFixture()
    const file = sampleRequest().files[0]!
    const active = results.beginTransaction(createOperationId(), sampleRequest(), sampleProducer())
    const stale = results.beginTransaction(createOperationId(), sampleRequest(), sampleProducer())
    await active.writeArtifact(file.fileId, 'markdown', '# Active', { mediaType: 'text/markdown' })
    await stale.writeArtifact(file.fileId, 'markdown', '# Stale', { mediaType: 'text/markdown' })
    await utimes(active.stagingDir, past, past)
    await utimes(stale.stagingDir, past, past)
    expect(await results.cleanupStaging(3600 * 1000, new Set([active.operationId]))).toBe(1)
    await expect(stat(stale.stagingDir)).rejects.toThrow()
    await expect(stat(active.stagingDir)).resolves.toBeDefined()
  })
})
