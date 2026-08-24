import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  asProviderConfigId,
  asSessionId,
  createFileId,
  createJobId,
  createOperationId,
  type CacheKey,
  type SessionId,
} from '../src/domain/ids.js'
import { MINERU_JOB_SCHEMA_VERSION, type MinerUJobRecord } from '../src/domain/job.js'
import { CANONICAL_PARSE_REQUEST_SCHEMA_VERSION, type CanonicalParseRequest } from '../src/domain/request.js'
import type { ResultProducer } from '../src/domain/result.js'
import { computeCacheKey } from '../src/service/cache-key.js'
import {
  JobRepository,
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

function sessionObject(id: SessionId): { readonly header: { readonly id: SessionId } } {
  return { header: { id } }
}

function sampleJob(sessionId: SessionId, request: CanonicalParseRequest, producer: ResultProducer): MinerUJobRecord {
  const file = request.files[0]!
  const cacheKey = computeCacheKey(request, file, producer.compatibilityKey)
  return {
    schemaVersion: MINERU_JOB_SCHEMA_VERSION,
    id: createJobId(),
    sessionId,
    providerId: producer.providerId,
    providerConfigId: producer.providerConfigId,
    providerCompatibilityKey: producer.compatibilityKey,
    sourceFiles: [{ fileId: file.fileId, name: file.name, bytes: file.bytes, sha256: file.sha256 }],
    request,
    cacheKey,
    state: 'completed',
    resolution: { kind: 'cache-hit' },
    files: [{ fileId: file.fileId, name: file.name, cacheKey, state: 'completed' }],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

interface MaintenanceFixture {
  readonly paths: StoragePaths
  readonly results: ResultRepository
  readonly jobs: JobRepository
  readonly maintenance: StorageMaintenanceService
  readonly lock: ProcessLock
}

async function createMaintenanceFixture(): Promise<MaintenanceFixture> {
  const root = await createTempRoot()
  const paths = new StoragePaths(root)
  const results = new ResultRepository(paths)
  const jobs = new JobRepository(paths)
  const lock = new ProcessLock(paths)
  await lock.acquire()
  heldLocks.push(lock)
  return { paths, results, jobs, maintenance: new StorageMaintenanceService(paths, results, lock), lock }
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
  it('reports normal-store usage without following symlinks', async () => {
    const { paths, results, jobs, maintenance } = await createMaintenanceFixture()
    const published = await publish(results, 'a'.repeat(64), '# published')
    const request = sampleRequest('a'.repeat(64))
    await jobs.create(sessionObject(asSessionId('stats-session')), sampleJob(asSessionId('stats-session'), request, sampleProducer()))

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
    expect(stats.persistedJobs.logicalEntryCount).toBe(1)
    expect(stats.staging.logicalEntryCount).toBe(1)
    expect(stats.quarantine.logicalEntryCount).toBe(1)
    expect(stats.publishedResults.byteUsage).toBeGreaterThan(0)
    expect(stats.persistedJobs.byteUsage).toBeGreaterThan(0)
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

  it('requires the existing held process lock', async () => {
    const root = await createTempRoot()
    const paths = new StoragePaths(root)
    const results = new ResultRepository(paths)
    const lock = new ProcessLock(paths)
    const maintenance = new StorageMaintenanceService(paths, results, lock)
    await expect(maintenance.getStatistics()).rejects.toMatchObject({ failure: { code: 'STORAGE_LOCKED' } })
  })
})

describe('StorageMaintenanceService quarantine operations', () => {
  it('lists bounded quarantine entries and cleans only requested safe entries', async () => {
    const { paths, results, jobs, maintenance } = await createMaintenanceFixture()
    const published = await publish(results, 'a'.repeat(64), '# preserve result')
    const request = sampleRequest('a'.repeat(64))
    const session = asSessionId('cleanup-session')
    const persistedJob = sampleJob(session, request, sampleProducer())
    await jobs.create(sessionObject(session), persistedJob)
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
    await expect(stat(paths.jobFile(session, persistedJob.id))).resolves.toBeDefined()
    await expect(stat(staging.stagingDir)).resolves.toBeDefined()
    expect(await readFile(outside, 'utf8')).toBe('outside')
  })

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

describe('StorageMaintenanceService GC dry run', () => {
  it('retains every parsed job cache-key reference and returns bounded orphan candidates without deletion', async () => {
    const { paths, results, jobs, maintenance } = await createMaintenanceFixture()
    const firstReferenced = await publish(results, 'a'.repeat(64), '# first reference')
    const secondReferenced = await publish(results, 'b'.repeat(64), '# second reference')
    const orphanOne = await publish(results, 'c'.repeat(64), '# orphan one')
    const orphanTwo = await publish(results, 'd'.repeat(64), '# orphan two')

    const session = asSessionId('gc-session')
    const firstJob = sampleJob(session, sampleRequest('a'.repeat(64)), sampleProducer())
    const secondJob = sampleJob(session, sampleRequest('b'.repeat(64)), sampleProducer())
    await jobs.create(sessionObject(session), {
      ...firstJob, cacheKey: firstReferenced.cacheKey,
      files: firstJob.files.map(file => ({ ...file, cacheKey: firstReferenced.cacheKey })),
    })
    await jobs.create(sessionObject(session), {
      ...secondJob, cacheKey: secondReferenced.cacheKey,
      files: secondJob.files.map(file => ({ ...file, cacheKey: secondReferenced.cacheKey })),
    })

    const report = await maintenance.gcDryRun({ candidateLimit: 1 })
    expect(report.dryRun).toBe(true)
    expect(report.referencePolicy).toBe('job-reference-retention')
    expect(report.eligible).toBe(true)
    expect(report.jobReferences.complete).toBe(true)
    expect(report.referencedResultCount).toBe(2)
    expect(report.candidateCount).toBe(2)
    expect(report.candidates).toHaveLength(1)
    expect(report.candidatesTruncated).toBe(true)
    expect(report.candidates[0]!.cacheKey === orphanOne.cacheKey || report.candidates[0]!.cacheKey === orphanTwo.cacheKey).toBe(true)
    await expect(stat(paths.resultDir(firstReferenced.cacheKey))).resolves.toBeDefined()
    await expect(stat(paths.resultDir(secondReferenced.cacheKey))).resolves.toBeDefined()
    await expect(stat(paths.resultDir(orphanOne.cacheKey))).resolves.toBeDefined()
    await expect(stat(paths.resultDir(orphanTwo.cacheKey))).resolves.toBeDefined()
  })

  it('fails closed for malformed, oversized, temporary, or symlinked job records', async () => {
    const { paths, results, maintenance } = await createMaintenanceFixture()
    const orphan = await publish(results, 'a'.repeat(64), '# orphan')
    const session = asSessionId('gc-blocked-session')
    const jobId = createJobId()
    await mkdir(paths.jobDir(session), { recursive: true })
    await writeFile(paths.jobFile(session, jobId), '{not-json')

    const malformed = await maintenance.gcDryRun()
    expect(malformed.eligible).toBe(false)
    expect(malformed.jobReferences.complete).toBe(false)
    expect(malformed.jobReferences.malformedJobCount).toBe(1)
    expect(malformed.candidateCount).toBe(0)

    await rm(paths.jobFile(session, jobId))
    await writeFile(paths.jobFile(session, jobId), 'x'.repeat(1024 * 1024 + 1))
    const oversized = await maintenance.gcDryRun()
    expect(oversized.eligible).toBe(false)
    expect(oversized.jobReferences.malformedJobCount).toBe(1)
    expect(oversized.candidateCount).toBe(0)

    await rm(paths.jobFile(session, jobId))
    await writeFile(paths.jobTempFile(session, jobId, 'token'), 'partial')
    const temporary = await maintenance.gcDryRun()
    expect(temporary.eligible).toBe(false)
    expect(temporary.jobReferences.unsafeJobEntryCount).toBe(1)
    expect(temporary.candidateCount).toBe(0)

    await rm(paths.jobTempFile(session, jobId, 'token'))
    const outside = join(paths.root, 'outside-job.json')
    await writeFile(outside, '{not-json')
    await symlink(outside, paths.jobFile(session, jobId))
    const linked = await maintenance.gcDryRun()
    expect(linked.eligible).toBe(false)
    expect(linked.jobReferences.unsafeJobEntryCount).toBe(1)
    expect(linked.candidateCount).toBe(0)
    expect(await readFile(outside, 'utf8')).toBe('{not-json')
    await expect(stat(paths.resultDir(orphan.cacheKey))).resolves.toBeDefined()
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
