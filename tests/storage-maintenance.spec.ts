import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  asCacheKey,
  asProviderConfigId,
  createFileId,
  createOperationId,
  type CacheKey,
} from '../src/domain/ids.js'
import { CANONICAL_PARSE_REQUEST_SCHEMA_VERSION, type CanonicalParseRequest } from '../src/domain/request.js'
import type { ResultProducer } from '../src/domain/result.js'
import { SharedOperationRegistry } from '../src/service/shared-operations.js'
import {
  ProcessLock,
  ResultRepository,
  StorageMaintenanceService,
  StoragePaths,
} from '../src/storage/index.js'

const tempRoots: string[] = []
const heldLocks: ProcessLock[] = []

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mineru-maintenance-test-'))
  tempRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(heldLocks.splice(0).map(lock => lock.release().catch(() => undefined)))
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true }).catch(() => undefined)))
})

function sampleRequest(sourceSha256: string): CanonicalParseRequest {
  const fileId = createFileId(sourceSha256)
  return {
    schemaVersion: CANONICAL_PARSE_REQUEST_SCHEMA_VERSION,
    files: [{ fileId, name: 'sample.pdf', bytes: 1024, sha256: sourceSha256 }],
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
    providerConfigId: asProviderConfigId('mp_maintenance'),
    compatibilityKey: 'self-hosted-v2:maintenance:v1:pipeline',
  }
}

interface MaintenanceFixture {
  readonly paths: StoragePaths
  readonly results: ResultRepository
  readonly operations: SharedOperationRegistry
  readonly maintenance: StorageMaintenanceService
  readonly lock: ProcessLock
}

async function createMaintenanceFixture(): Promise<MaintenanceFixture> {
  const root = await createTempRoot()
  const paths = new StoragePaths(root)
  const results = new ResultRepository(paths)
  const operations = new SharedOperationRegistry()
  const lock = new ProcessLock(paths)
  await lock.acquire()
  heldLocks.push(lock)
  return { paths, results, operations, maintenance: new StorageMaintenanceService(paths, results, operations, lock), lock }
}

type MaintenanceBlocker = 'operation' | 'reader'

async function holdMaintenanceBlocker(
  fixture: MaintenanceFixture,
  blocker: MaintenanceBlocker,
): Promise<() => Promise<void>> {
  if (blocker === 'operation') {
    const reservation = fixture.operations.reserve(
      asCacheKey('9'.repeat(64)), asProviderConfigId('mp_maintenance'), 1000,
    )
    if (!reservation.created) throw new Error('failed to reserve maintenance test operation')
    return async () => { fixture.operations.dispose() }
  }

  let release!: () => void
  const held = fixture.maintenance.accessGate.runShared(async () => await new Promise<void>(resolve => { release = resolve }))
  return async () => {
    release()
    await held
  }
}

async function publish(
  results: ResultRepository,
  sourceSha256: string,
  content: string,
): Promise<{ readonly cacheKey: CacheKey; readonly fileId: string; readonly artifactPath: string }> {
  const request = sampleRequest(sourceSha256)
  const transaction = results.beginTransaction(createOperationId(), request, sampleProducer())
  const file = request.files[0]!
  const artifact = await transaction.writeArtifact(file.fileId, 'markdown', content, { mediaType: 'text/markdown; charset=utf-8' })
  const committed = await results.commitTransaction(transaction, transaction.buildManifest(file, [artifact]))
  return { cacheKey: committed.cacheKey, fileId: file.fileId, artifactPath: artifact.relativePath }
}

async function makePublishedWritable(paths: StoragePaths, cacheKey: CacheKey, fileId: string): Promise<void> {
  await chmod(paths.resultDir(cacheKey), 0o755)
  await chmod(paths.filesDir(cacheKey), 0o755)
  await chmod(paths.fileDir(cacheKey, fileId), 0o755)
  await chmod(paths.manifestFile(cacheKey), 0o644).catch(() => undefined)
}

describe('StorageMaintenanceService statistics and integrity', () => {
  it('reports normal cache usage without following symlinks', async () => {
    const { paths, results, maintenance } = await createMaintenanceFixture()
    const published = await publish(results, 'a'.repeat(64), '# published')

    const staging = results.beginTransaction(createOperationId(), sampleRequest('b'.repeat(64)), sampleProducer())
    await staging.writeArtifact(sampleRequest('b'.repeat(64)).files[0]!.fileId, 'markdown', '# staging', { mediaType: 'text/markdown' })

    const quarantine = paths.quarantineDir('manual_entry')
    await mkdir(quarantine, { recursive: true })
    await writeFile(join(quarantine, 'note.txt'), 'quarantine bytes')
    const outside = join(paths.root, 'outside.txt')
    await writeFile(outside, 'must not be counted through a symlink')
    await symlink(outside, join(paths.quarantineDir(), 'outside-link'))

    const stats = await maintenance.getStatistics()
    expect(stats.publishedResults.logicalEntryCount).toBe(1)
    expect(stats.staging.logicalEntryCount).toBe(1)
    expect(stats.quarantine.logicalEntryCount).toBe(1)
    expect(stats.publishedResults.byteUsage).toBeGreaterThan(0)
    expect(stats.staging.byteUsage).toBeGreaterThan(0)
    expect(stats.quarantine.byteUsage).toBe('quarantine bytes'.length)
    expect(stats.quarantine.skippedSymlinkCount).toBe(1)
    expect(await readFile(outside, 'utf8')).toBe('must not be counted through a symlink')
    expect(await stat(paths.resultDir(published.cacheKey))).toBeDefined()
  })

  it('uses a read-only strict scan by default and isolates invalid results only on request', async () => {
    const { paths, results, maintenance } = await createMaintenanceFixture()
    const valid = await publish(results, 'a'.repeat(64), '# valid')
    const malformedManifest = await publish(results, 'b'.repeat(64), '# malformed')
    const missingArtifact = await publish(results, 'c'.repeat(64), '# missing')
    const symlinkArtifact = await publish(results, 'd'.repeat(64), '# symlink')

    await makePublishedWritable(paths, malformedManifest.cacheKey, malformedManifest.fileId)
    await writeFile(paths.manifestFile(malformedManifest.cacheKey), '{invalid json')

    await makePublishedWritable(paths, missingArtifact.cacheKey, missingArtifact.fileId)
    await rm(paths.resolveArtifactPath(missingArtifact.cacheKey, missingArtifact.artifactPath))

    await makePublishedWritable(paths, symlinkArtifact.cacheKey, symlinkArtifact.fileId)
    const outside = join(paths.root, 'outside-artifact.md')
    await writeFile(outside, '# outside')
    const symlinkPath = paths.resolveArtifactPath(symlinkArtifact.cacheKey, symlinkArtifact.artifactPath)
    await rm(symlinkPath)
    await symlink(outside, symlinkPath)

    const readOnly = await maintenance.scanIntegrity({ diagnosticLimit: 2 })
    expect(readOnly.readOnly).toBe(true)
    expect(readOnly.isolateInvalid).toBe(false)
    expect(readOnly.validCount).toBe(1)
    expect(readOnly.corruptCount).toBe(2)
    expect(readOnly.missingCount).toBe(1)
    expect(readOnly.quarantinedCount).toBe(0)
    expect(readOnly.diagnostics).toHaveLength(2)
    expect(readOnly.scan.diagnosticsTruncated).toBe(true)
    await expect(stat(paths.resultDir(malformedManifest.cacheKey))).resolves.toBeDefined()
    await expect(stat(paths.resultDir(missingArtifact.cacheKey))).resolves.toBeDefined()
    await expect(stat(paths.resultDir(symlinkArtifact.cacheKey))).resolves.toBeDefined()
    expect(await readFile(outside, 'utf8')).toBe('# outside')

    const isolated = await maintenance.scanIntegrity({ isolateInvalid: true })
    expect(isolated.readOnly).toBe(false)
    expect(isolated.quarantinedCount).toBe(3)
    await expect(stat(paths.resultDir(valid.cacheKey))).resolves.toBeDefined()
    await expect(stat(paths.resultDir(malformedManifest.cacheKey))).rejects.toThrow()
    await expect(stat(paths.resultDir(missingArtifact.cacheKey))).rejects.toThrow()
    await expect(stat(paths.resultDir(symlinkArtifact.cacheKey))).rejects.toThrow()
    expect(await readFile(outside, 'utf8')).toBe('# outside')
  })

  it.each(['operation', 'reader'] as const)(
    'blocks destructive isolation while storage has an active %s',
    async blocker => {
      const fixture = await createMaintenanceFixture()
      const published = await publish(fixture.results, '8'.repeat(64), '# invalid')
      await makePublishedWritable(fixture.paths, published.cacheKey, published.fileId)
      await writeFile(fixture.paths.manifestFile(published.cacheKey), '{invalid json')
      const release = await holdMaintenanceBlocker(fixture, blocker)

      try {
        await expect(fixture.maintenance.scanIntegrity({ isolateInvalid: true }))
          .rejects.toMatchObject({ failure: { code: 'STORAGE_LOCKED' } })
      } finally {
        await release()
      }
      await expect(stat(fixture.paths.resultDir(published.cacheKey))).resolves.toBeDefined()
    },
  )

  it('reports scan truncation and undeclared published data without mutating valid results', async () => {
    const { paths, results, maintenance } = await createMaintenanceFixture()
    const first = await publish(results, 'a'.repeat(64), '# first')
    await publish(results, 'b'.repeat(64), '# second')
    await publish(results, 'c'.repeat(64), '# third')

    const truncated = await maintenance.scanIntegrity({ resultLimit: 1 })
    expect(truncated.scan.scanned).toBe(1)
    expect(truncated.scan.truncated).toBe(true)

    await makePublishedWritable(paths, first.cacheKey, first.fileId)
    await writeFile(join(paths.resultDir(first.cacheKey), 'undeclared.txt'), 'unexpected')
    const scan = await maintenance.scanIntegrity()
    expect(scan.corruptCount).toBeGreaterThanOrEqual(1)
    expect(scan.diagnostics.some(diagnostic => diagnostic.code === 'corrupt-result')).toBe(true)
    await expect(stat(paths.resultDir(first.cacheKey))).resolves.toBeDefined()
  })

  it('honors a cancelled integrity scan without mutation', async () => {
    const { paths, results, maintenance } = await createMaintenanceFixture()
    const published = await publish(results, 'a'.repeat(64), '# cancelled')
    const controller = new AbortController()
    controller.abort(new DOMException('Cancelled', 'AbortError'))
    await expect(maintenance.scanIntegrity({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    await expect(stat(paths.resultDir(published.cacheKey))).resolves.toBeDefined()
  })

  it('blocks destructive cache clear when process lock is held by another active process', async () => {
    const root = await createTempRoot()
    const paths = new StoragePaths(root)
    const results = new ResultRepository(paths)
    const activeLock = new ProcessLock(paths)
    await activeLock.acquire()
    try {
      const contenderLock = new ProcessLock(paths)
      const maintenance = new StorageMaintenanceService(paths, results, new SharedOperationRegistry(), contenderLock)
      await expect(maintenance.clearCache({ dryRun: false })).rejects.toMatchObject({ failure: { code: 'STORAGE_LOCKED' } })
    } finally {
      await activeLock.release()
    }
  })
})

describe('StorageMaintenanceService quarantine operations', () => {
  it('lists bounded quarantine entries and cleans only requested safe entries', async () => {
    const { paths, results, maintenance } = await createMaintenanceFixture()
    const published = await publish(results, 'a'.repeat(64), '# preserve result')
    const staging = results.beginTransaction(createOperationId(), sampleRequest('b'.repeat(64)), sampleProducer())
    await staging.writeArtifact(sampleRequest('b'.repeat(64)).files[0]!.fileId, 'markdown', '# preserve staging', { mediaType: 'text/markdown' })

    for (let index = 0; index < 16; index++) {
      const entry = paths.quarantineDir('entry_' + String(index))
      await mkdir(entry, { recursive: true })
      await writeFile(join(entry, 'payload.txt'), 'payload-' + String(index))
    }
    const outside = join(paths.root, 'outside-quarantine.txt')
    await writeFile(outside, 'outside')
    await symlink(outside, join(paths.quarantineDir(), 'unsafe-link'))

    const listed = await maintenance.listQuarantine({ limit: 3 })
    expect(listed.totalCount).toBe(16)
    expect(listed.entries).toHaveLength(3)
    expect(listed.truncated).toBe(true)
    expect(listed.skippedSymlinkCount).toBe(1)

    await expect(maintenance.cleanupQuarantine({ entryIds: ['../results'], dryRun: false })).rejects.toThrow(TypeError)
    const dryRun = await maintenance.cleanupQuarantine({ entryIds: ['entry_0'] })
    expect(dryRun.dryRun).toBe(true)
    expect(dryRun.plannedCount).toBe(1)
    await expect(stat(paths.quarantineDir('entry_0'))).resolves.toBeDefined()

    const cleaned = await maintenance.cleanupQuarantine({ entryIds: ['entry_0'], dryRun: false })
    expect(cleaned.dryRun).toBe(false)
    expect(cleaned.deletedCount).toBe(1)
    await expect(stat(paths.quarantineDir('entry_0'))).rejects.toThrow()
    await expect(stat(paths.resultDir(published.cacheKey))).resolves.toBeDefined()
    await expect(stat(staging.stagingDir)).resolves.toBeDefined()
    expect(await readFile(outside, 'utf8')).toBe('outside')
  })

  it.each(['operation', 'reader'] as const)(
    'blocks destructive cleanup while storage has an active %s',
    async blocker => {
      const fixture = await createMaintenanceFixture()
      const entry = fixture.paths.quarantineDir('blocked_entry')
      await mkdir(entry, { recursive: true })
      await writeFile(join(entry, 'payload.txt'), 'preserve')
      const release = await holdMaintenanceBlocker(fixture, blocker)

      try {
        await expect(fixture.maintenance.cleanupQuarantine({ entryIds: ['blocked_entry'], dryRun: false }))
          .rejects.toMatchObject({ failure: { code: 'STORAGE_LOCKED' } })
      } finally {
        await release()
      }
      await expect(stat(entry)).resolves.toBeDefined()
    },
  )

  it('refuses a symlinked quarantine root without touching its target', async () => {
    const { paths, maintenance } = await createMaintenanceFixture()
    const outside = await mkdtemp(join(tmpdir(), 'mineru-maintenance-outside-'))
    tempRoots.push(outside)
    await mkdir(join(outside, 'entry_0'), { recursive: true })
    await writeFile(join(outside, 'entry_0', 'payload.txt'), 'outside payload')
    await symlink(outside, paths.quarantineDir())

    const report = await maintenance.cleanupQuarantine({ entryIds: ['entry_0'], dryRun: false })
    expect(report.deletedCount).toBe(0)
    expect(report.skippedCount).toBe(1)
    expect(await readFile(join(outside, 'entry_0', 'payload.txt'), 'utf8')).toBe('outside payload')
  })

  it('preserves unsafe quarantine trees and removes verified read-only result quarantine trees', async () => {
    const { paths, results, maintenance } = await createMaintenanceFixture()
    const published = await publish(results, 'a'.repeat(64), '# to quarantine')
    const physical = paths.resolveArtifactPath(published.cacheKey, published.artifactPath)
    await makePublishedWritable(paths, published.cacheKey, published.fileId)
    await rm(physical)
    expect(await results.get(published.cacheKey)).toBeUndefined()

    const resultQuarantine = await maintenance.listQuarantine()
    expect(resultQuarantine.totalCount).toBe(1)
    const quarantineId = resultQuarantine.entries[0]!.id
    const cleaned = await maintenance.cleanupQuarantine({ entryIds: [quarantineId], dryRun: false })
    expect(cleaned.deletedCount).toBe(1)
    await expect(stat(paths.quarantineDir(quarantineId))).rejects.toThrow()

    const unsafe = paths.quarantineDir('unsafe_entry')
    await mkdir(unsafe, { recursive: true })
    const outside = join(paths.root, 'outside-unsafe.txt')
    await writeFile(outside, 'safe outside')
    await symlink(outside, join(unsafe, 'payload-link'))
    const skipped = await maintenance.cleanupQuarantine({ entryIds: ['unsafe_entry'], dryRun: false })
    expect(skipped.plannedCount).toBe(0)
    expect(skipped.skippedCount).toBe(1)
    await expect(stat(unsafe)).resolves.toBeDefined()
    expect(await readFile(outside, 'utf8')).toBe('safe outside')
  })
})

describe('StorageMaintenanceService cache clear', () => {
  it('previews then deletes all published results while no parse operation is active', async () => {
    const { paths, results, maintenance } = await createMaintenanceFixture()
    const first = await publish(results, 'a'.repeat(64), '# first')
    const second = await publish(results, 'b'.repeat(64), '# second')

    const preview = await maintenance.clearCache()
    expect(preview.dryRun).toBe(true)
    expect(preview.eligible).toBe(true)
    expect(preview.plannedCount).toBe(2)
    expect(preview.deletedCount).toBe(0)
    await expect(stat(paths.resultDir(first.cacheKey))).resolves.toBeDefined()
    await expect(stat(paths.resultDir(second.cacheKey))).resolves.toBeDefined()

    const cleared = await maintenance.clearCache({ dryRun: false, confirmationToken: preview.confirmationToken })
    expect(cleared.eligible).toBe(true)
    expect(cleared.deletedCount).toBe(2)
    expect(cleared.deletedBytes).toBeGreaterThan(0)
    expect(cleared.skippedCount).toBe(0)
    await expect(stat(paths.resultDir(first.cacheKey))).rejects.toThrow()
    await expect(stat(paths.resultDir(second.cacheKey))).rejects.toThrow()
  })

  it('blocks deletion while a background shared operation is still active', async () => {
    const { paths, results, operations, maintenance } = await createMaintenanceFixture()
    const published = await publish(results, 'e'.repeat(64), '# producer')
    const reserved = operations.reserve(published.cacheKey, asProviderConfigId('mp_maintenance'), 1000)
    expect(reserved.created).toBe(true)

    const report = await maintenance.clearCache({ dryRun: false })
    expect(report.eligible).toBe(false)
    expect(report.activeOperationCount).toBe(1)
    expect(report.deletedCount).toBe(0)
    await expect(stat(paths.resultDir(published.cacheKey))).resolves.toBeDefined()
    operations.dispose()
  })
  it('blocks deletion while a model tool holds shared storage access', async () => {
    const { paths, results, maintenance } = await createMaintenanceFixture()
    const published = await publish(results, 'e'.repeat(64), '# leased')
    let release!: () => void
    const held = maintenance.accessGate.runShared(async () => await new Promise<void>(resolve => { release = resolve }))

    const report = await maintenance.clearCache({ dryRun: false, confirmationToken: 'stale' })
    expect(report.eligible).toBe(false)
    expect(report.activeAccessCount).toBe(1)
    expect(report.deletedCount).toBe(0)
    await expect(stat(paths.resultDir(published.cacheKey))).resolves.toBeDefined()
    release()
    await held
  })

  it('rejects a stale preview when the result set changes', async () => {
    const { paths, results, maintenance } = await createMaintenanceFixture()
    const first = await publish(results, 'f'.repeat(64), '# first')
    const preview = await maintenance.clearCache()
    const second = await publish(results, '1'.repeat(64), '# second')

    const report = await maintenance.clearCache({
      dryRun: false,
      confirmationToken: preview.confirmationToken,
    })
    expect(report.eligible).toBe(false)
    expect(report.deletedCount).toBe(0)
    await expect(stat(paths.resultDir(first.cacheKey))).resolves.toBeDefined()
    await expect(stat(paths.resultDir(second.cacheKey))).resolves.toBeDefined()
  })

  it('rejects symlinked result ancestors without touching the target', async () => {
    const { paths, results, maintenance } = await createMaintenanceFixture()
    const published = await publish(results, '2'.repeat(64), '# ancestor')
    const outside = join(paths.root, 'outside-results')
    await mkdir(outside)
    await rename(paths.resultsDir(), join(outside, 'sha256'))
    await rm(join(paths.root, 'results'), { recursive: true })
    await symlink(outside, join(paths.root, 'results'))

    const report = await maintenance.clearCache()
    expect(report.eligible).toBe(false)
    expect(report.confirmationToken).toBeUndefined()
    await expect(stat(paths.resultDir(published.cacheKey))).resolves.toBeDefined()
  })

  it('never follows symlinks while clearing cache', async () => {
    const { paths, results, maintenance } = await createMaintenanceFixture()
    const published = await publish(results, 'd'.repeat(64), '# linked')
    const outside = join(paths.root, 'outside-cache.txt')
    await writeFile(outside, 'preserve me')
    await makePublishedWritable(paths, published.cacheKey, published.fileId)
    await symlink(outside, join(paths.fileDir(published.cacheKey, published.fileId), 'outside-link'))

    const report = await maintenance.clearCache({ dryRun: false })
    expect(report.eligible).toBe(false)
    expect(report.deletedCount).toBe(0)
    expect(report.skippedCount).toBe(1)
    expect(await readFile(outside, 'utf8')).toBe('preserve me')
    await expect(stat(paths.resultDir(published.cacheKey))).resolves.toBeDefined()
  })
})

describe('StorageMaintenanceService GC dry run', () => {
  it('returns bounded candidates without deleting published results', async () => {
    const { paths, results, maintenance } = await createMaintenanceFixture()
    const first = await publish(results, 'a'.repeat(64), '# first')
    const second = await publish(results, 'b'.repeat(64), '# second')

    const report = await maintenance.gcDryRun({ candidateLimit: 1 })
    expect(report.dryRun).toBe(true)
    expect(report.eligible).toBe(true)
    expect(report.candidateCount).toBe(2)
    expect(report.candidates).toHaveLength(1)
    expect(report.candidatesTruncated).toBe(true)
    expect([first.cacheKey, second.cacheKey]).toContain(report.candidates[0]!.cacheKey)
    await expect(stat(paths.resultDir(first.cacheKey))).resolves.toBeDefined()
    await expect(stat(paths.resultDir(second.cacheKey))).resolves.toBeDefined()
  })
  it('never makes corrupt or scan-truncated results GC candidates', async () => {
    const { paths, results, maintenance } = await createMaintenanceFixture()
    const corrupt = await publish(results, 'a'.repeat(64), 'same-size-A')
    const validOne = await publish(results, 'b'.repeat(64), '# valid one')
    const validTwo = await publish(results, 'c'.repeat(64), '# valid two')

    await makePublishedWritable(paths, corrupt.cacheKey, corrupt.fileId)
    const physical = paths.resolveArtifactPath(corrupt.cacheKey, corrupt.artifactPath)
    await chmod(physical, 0o644)
    await writeFile(physical, 'same-size-B')

    const full = await maintenance.gcDryRun()
    expect(full.invalidResultCount).toBe(1)
    expect(full.candidateCount).toBe(2)
    expect(full.candidates.some(candidate => candidate.cacheKey === corrupt.cacheKey)).toBe(false)
    await expect(stat(paths.resultDir(corrupt.cacheKey))).resolves.toBeDefined()

    const outsidePrefix = join(paths.root, 'outside-prefix')
    await mkdir(outsidePrefix)
    await symlink(outsidePrefix, join(paths.resultsDir(), 'ff'))
    const incomplete = await maintenance.gcDryRun()
    expect(incomplete.eligible).toBe(false)
    expect(incomplete.candidateTotalsComplete).toBe(false)

    const truncated = await maintenance.gcDryRun({ resultLimit: 1 })
    expect(truncated.scan.truncated).toBe(true)
    expect(truncated.eligible).toBe(false)
    expect(truncated.candidateTotalsComplete).toBe(false)
    await expect(stat(paths.resultDir(validOne.cacheKey))).resolves.toBeDefined()
    await expect(stat(paths.resultDir(validTwo.cacheKey))).resolves.toBeDefined()
  })
})
