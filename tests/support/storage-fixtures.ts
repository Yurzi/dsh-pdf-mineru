/** Shared storage fixtures: temp roots with automatic cleanup and real repository graphs. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFinished } from 'vitest'
import { asCacheKey, asProviderConfigId, createFileId, createOperationId, type CacheKey, type MinerUFileId } from '../../src/domain/ids.js'
import { CANONICAL_PARSE_REQUEST_SCHEMA_VERSION, type CanonicalParseRequest } from '../../src/domain/request.js'
import type { MinerUResultManifest, ResultProducer } from '../../src/domain/result.js'
import { SharedOperationRegistry } from '../../src/service/shared-operations.js'
import { StorageAccessGate } from '../../src/storage/access-gate.js'
import { StorageMaintenanceService } from '../../src/storage/maintenance/service.js'
import { StoragePaths } from '../../src/storage/paths.js'
import { ProcessLock, type ProcessLockOptions } from '../../src/storage/process-lock.js'
import { ResultRepository, type ResultRepositoryOptions } from '../../src/storage/result-repository.js'

/** Fresh temporary directory removed when the current test finishes. Call only inside a test. */
export async function tempRoot(prefix = 'mineru-storage-'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
  return root
}

export const SHA_A = 'a'.repeat(64)

export function sampleRequest(sourceSha256 = SHA_A, overrides: Partial<CanonicalParseRequest> = {}): CanonicalParseRequest {
  return {
    schemaVersion: CANONICAL_PARSE_REQUEST_SCHEMA_VERSION,
    files: [{ fileId: createFileId(sourceSha256), name: 'sample.pdf', bytes: 1024, sha256: sourceSha256 }],
    semantics: { model: 'pipeline', ocr: false, parseMethod: 'auto', language: 'ch', formula: true, table: true },
    requiredArtifacts: ['markdown'],
    ...overrides,
  }
}

export function sampleProducer(): ResultProducer {
  return {
    providerId: 'self-hosted-legacy-v2',
    providerConfigId: asProviderConfigId('mp_default'),
    compatibilityKey: 'self-hosted-legacy-v2:test-hash:v1:pipeline',
  }
}

export interface StorageFixtureOptions {
  readonly root?: string
  readonly repository?: ResultRepositoryOptions
  readonly lock?: ProcessLockOptions
}

export interface StorageFixture {
  readonly root: string
  readonly paths: StoragePaths
  readonly lock: ProcessLock
  readonly results: ResultRepository
}

export async function storageFixture(options: StorageFixtureOptions = {}): Promise<StorageFixture> {
  const root = options.root ?? await tempRoot()
  const paths = new StoragePaths(root)
  const lock = new ProcessLock(paths, options.lock)
  return { root, paths, lock, results: new ResultRepository(paths, options.repository ?? {}, lock) }
}

export interface MaintenanceFixture extends StorageFixture {
  readonly operations: SharedOperationRegistry
  readonly accessGate: StorageAccessGate
  readonly maintenance: StorageMaintenanceService
}

/** Real maintenance graph: repository, scoped lock, access gate and an in-process operation registry. */
export async function maintenanceFixture(options: StorageFixtureOptions = {}): Promise<MaintenanceFixture> {
  const storage = await storageFixture(options)
  const operations = new SharedOperationRegistry()
  onTestFinished(() => operations.dispose())
  const accessGate = new StorageAccessGate({ paths: storage.paths, lock: storage.lock })
  const maintenance = new StorageMaintenanceService(storage.paths, storage.results, operations, storage.lock, accessGate)
  return { ...storage, operations, accessGate, maintenance }
}

export interface PublishedFixture {
  readonly cacheKey: CacheKey
  readonly fileId: MinerUFileId
  readonly artifactPath: string
  readonly manifest: MinerUResultManifest
}

/** Publish one markdown-only result through the real staging transaction. */
export async function publish(results: ResultRepository, sourceSha256 = SHA_A, content = '# published'): Promise<PublishedFixture> {
  const request = sampleRequest(sourceSha256)
  const tx = results.beginTransaction(createOperationId(), request, sampleProducer())
  const file = request.files[0]!
  const artifact = await tx.writeArtifact(file.fileId, 'markdown', content, { mediaType: 'text/markdown; charset=utf-8' })
  const committed = await results.commitTransaction(tx, tx.buildManifest(file, [artifact]))
  return { cacheKey: committed.cacheKey, fileId: file.fileId, artifactPath: artifact.relativePath, manifest: committed.manifest }
}

export type StorageBlocker = 'operation' | 'reader'

/** Hold an in-process parse reservation or a shared reader lease until the returned release runs. */
export async function holdBlocker(fixture: MaintenanceFixture, blocker: StorageBlocker): Promise<() => Promise<void>> {
  if (blocker === 'reader') return await holdSharedAccess(fixture.accessGate)
  const reservation = fixture.operations.reserve(asCacheKey('9'.repeat(64)), asProviderConfigId('mp_default'), 1000)
  if (!reservation.created) throw new Error('failed to reserve fixture operation')
  return async () => { fixture.operations.dispose() }
}

/** Enter a shared storage lease and keep it until the returned release runs. */
export async function holdSharedAccess(gate: StorageAccessGate): Promise<() => Promise<void>> {
  let release!: () => void
  let entered!: () => void
  const ready = new Promise<void>(resolve => { entered = resolve })
  const held = gate.runShared(async () => {
    entered()
    await new Promise<void>(resolve => { release = resolve })
  })
  await ready
  return async () => { release(); await held }
}
