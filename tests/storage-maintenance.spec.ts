import { mkdir, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createOperationId } from '../src/domain/ids.js'
import { ProcessLock } from '../src/storage/process-lock.js'
import { StorageAccessGate } from '../src/storage/access-gate.js'
import { StorageMaintenanceService } from '../src/storage/maintenance/service.js'
import {
  holdBlocker, maintenanceFixture, publish, sampleProducer, sampleRequest, tempRoot,
  type MaintenanceFixture, type StorageBlocker,
} from './support/storage-fixtures.js'

const exists = (path: string) => expect(stat(path)).resolves.toBeDefined()
const absent = (path: string) => expect(stat(path)).rejects.toThrow()

async function stageUnpublished(fixture: MaintenanceFixture, sha: string): Promise<string> {
  const request = sampleRequest(sha)
  const tx = fixture.results.beginTransaction(createOperationId(), request, sampleProducer())
  await tx.writeArtifact(request.files[0]!.fileId, 'markdown', '# staging', { mediaType: 'text/markdown' })
  return tx.stagingDir
}

async function quarantineEntry(fixture: MaintenanceFixture, id: string, payload = 'payload'): Promise<string> {
  const entry = fixture.paths.quarantineDir(id)
  await mkdir(entry, { recursive: true })
  await writeFile(join(entry, 'payload.txt'), payload)
  return entry
}

describe('StorageMaintenanceService statistics and integrity', () => {
  it('reports cache usage per area without following symlinks', async () => {
    const fixture = await maintenanceFixture()
    const { paths, maintenance } = fixture
    await publish(fixture.results)
    await stageUnpublished(fixture, 'b'.repeat(64))
    await quarantineEntry(fixture, 'manual_entry', 'quarantine bytes')
    const outside = join(paths.root, 'outside.txt')
    await writeFile(outside, 'must not be counted through a symlink')
    await symlink(outside, join(paths.quarantineDir(), 'outside-link'))

    const stats = await maintenance.getStatistics()
    expect(stats.publishedResults).toMatchObject({ logicalEntryCount: 1, byteUsage: expect.any(Number) })
    expect(stats.publishedResults.byteUsage).toBeGreaterThan(0)
    expect(stats.staging.logicalEntryCount).toBe(1)
    expect(stats.staging.byteUsage).toBeGreaterThan(0)
    expect(stats.quarantine).toMatchObject({ logicalEntryCount: 1, byteUsage: 'quarantine bytes'.length, skippedSymlinkCount: 1 })
    expect(await readFile(outside, 'utf8')).toBe('must not be counted through a symlink')
  })

  it('does not traverse or initialize storage through a symlinked root or results directory', async () => {
    const outside = await tempRoot()
    await mkdir(join(outside, 'results', 'sha256', 'aa'), { recursive: true })
    await mkdir(join(outside, 'quarantine', 'outside_entry'), { recursive: true })
    await writeFile(join(outside, 'quarantine', 'outside_entry', 'preserve.txt'), 'preserve')
    const alias = join(await tempRoot(), 'storage-alias')
    await symlink(outside, alias)
    const { maintenance } = await maintenanceFixture({ root: alias })
    expect((await maintenance.getStatistics()).publishedResults).toMatchObject({ complete: false, byteUsage: 0 })
    const integrity = await maintenance.scanIntegrity()
    expect(integrity.validCount).toBe(0)
    expect(integrity.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'unreadable-entry' })]))
    expect(await maintenance.listQuarantine()).toMatchObject({ totalCount: 0, unreadableEntryCount: 1 })
    expect(await readFile(join(outside, 'quarantine', 'outside_entry', 'preserve.txt'), 'utf8')).toBe('preserve')
    await absent(join(outside, '.lock'))

    const realRoot = await tempRoot()
    const outsideResults = await tempRoot()
    await mkdir(join(realRoot, 'results'))
    await mkdir(join(outsideResults, 'aa'))
    await writeFile(join(outsideResults, 'aa', 'preserve.txt'), 'preserve results')
    const intermediate = await maintenanceFixture({ root: realRoot })
    await symlink(outsideResults, intermediate.paths.resultsDir())
    expect((await intermediate.maintenance.getStatistics()).publishedResults).toMatchObject({ complete: false, byteUsage: 0 })
    expect((await intermediate.maintenance.scanIntegrity()).validCount).toBe(0)
    expect(await readFile(join(outsideResults, 'aa', 'preserve.txt'), 'utf8')).toBe('preserve results')
    await absent(join(realRoot, '.lock'))
  })

  it('scans read-only by default and isolates only invalid results on request', async () => {
    const fixture = await maintenanceFixture()
    const { paths, results, maintenance } = fixture
    const valid = await publish(results, 'a'.repeat(64), '# valid')
    const malformed = await publish(results, 'b'.repeat(64), '# malformed')
    const missing = await publish(results, 'c'.repeat(64), '# missing')
    const linked = await publish(results, 'd'.repeat(64), '# symlink')
    await writeFile(paths.manifestFile(malformed.cacheKey), '{invalid json')
    await rm(paths.resolveArtifactPath(missing.cacheKey, missing.artifactPath))
    const outside = join(paths.root, 'outside-artifact.md')
    await writeFile(outside, '# outside')
    const linkPath = paths.resolveArtifactPath(linked.cacheKey, linked.artifactPath)
    await rm(linkPath)
    await symlink(outside, linkPath)
    const invalid = [malformed, missing, linked].map(item => paths.resultDir(item.cacheKey))

    const readOnly = await maintenance.scanIntegrity({ diagnosticLimit: 2 })
    expect(readOnly).toMatchObject({
      readOnly: true, isolateInvalid: false, validCount: 1, corruptCount: 2, missingCount: 1, quarantinedCount: 0,
      scan: { diagnosticsTruncated: true },
    })
    expect(readOnly.diagnostics).toHaveLength(2)
    for (const dir of invalid) await exists(dir)

    const isolated = await maintenance.scanIntegrity({ isolateInvalid: true })
    expect(isolated).toMatchObject({ readOnly: false, quarantinedCount: 3 })
    await exists(paths.resultDir(valid.cacheKey))
    for (const dir of invalid) await absent(dir)
    expect(await readFile(outside, 'utf8')).toBe('# outside')
  })

  it('reports scan truncation and undeclared published data without mutating results', async () => {
    const { paths, results, maintenance } = await maintenanceFixture()
    const first = await publish(results, 'a'.repeat(64), '# first')
    await publish(results, 'b'.repeat(64), '# second')
    await publish(results, 'c'.repeat(64), '# third')
    expect((await maintenance.scanIntegrity({ resultLimit: 1 })).scan).toMatchObject({ scanned: 1, truncated: true })
    await writeFile(join(paths.resultDir(first.cacheKey), 'undeclared.txt'), 'unexpected')
    const scan = await maintenance.scanIntegrity()
    expect(scan.corruptCount).toBeGreaterThanOrEqual(1)
    expect(scan.diagnostics.some(diagnostic => diagnostic.code === 'corrupt-result')).toBe(true)
    await exists(paths.resultDir(first.cacheKey))
  })

  it.each([false, true])('honors a cancelled integrity scan without mutation (isolateInvalid=%s)', async isolateInvalid => {
    const { paths, results, maintenance } = await maintenanceFixture()
    const published = await publish(results)
    await writeFile(paths.manifestFile(published.cacheKey), '{invalid json')
    const controller = new AbortController()
    controller.abort(new DOMException('Cancelled', 'AbortError'))
    await expect(maintenance.scanIntegrity({ signal: controller.signal, isolateInvalid })).rejects.toMatchObject({ name: 'AbortError' })
    await exists(paths.resultDir(published.cacheKey))
  })
})

describe('StorageMaintenanceService fail-closed destructive work', () => {
  const destructive = {
    'integrity isolation': async (fixture: MaintenanceFixture) => {
      const published = await publish(fixture.results, '8'.repeat(64), '# invalid')
      await writeFile(fixture.paths.manifestFile(published.cacheKey), '{invalid json')
      return { run: () => fixture.maintenance.scanIntegrity({ isolateInvalid: true }), preserved: fixture.paths.resultDir(published.cacheKey) }
    },
    'quarantine cleanup': async (fixture: MaintenanceFixture) => ({
      run: () => fixture.maintenance.cleanupQuarantine({ entryIds: ['blocked_entry'], dryRun: false }),
      preserved: await quarantineEntry(fixture, 'blocked_entry'),
    }),
    'cache clear': async (fixture: MaintenanceFixture) => {
      const published = await publish(fixture.results, 'e'.repeat(64), '# leased')
      const preview = await fixture.maintenance.clearCache()
      return {
        run: () => fixture.maintenance.clearCache({ dryRun: false, confirmationToken: preview.confirmationToken }),
        preserved: fixture.paths.resultDir(published.cacheKey),
      }
    },
  } as const
  const cases = Object.keys(destructive).flatMap(operation =>
    (['operation', 'reader'] as const).map(blocker => [operation as keyof typeof destructive, blocker] as const))

  it.each(cases)('blocks %s while storage has an active %s', async (operation, blocker: StorageBlocker) => {
    const fixture = await maintenanceFixture()
    const { run, preserved } = await destructive[operation](fixture)
    const release = await holdBlocker(fixture, blocker)
    try {
      await expect(run()).rejects.toMatchObject({ failure: { code: 'STORAGE_LOCKED' } })
    } finally { await release() }
    await exists(preserved)
  })

  it('blocks destructive cache clear when the process lock is held by another owner', async () => {
    const { paths, lock, results } = await maintenanceFixture()
    await lock.acquire()
    try {
      const contender = new ProcessLock(paths, { acquireTimeoutMs: 100, pollIntervalMs: 2 })
      const maintenance = new StorageMaintenanceService(paths, results, { activeOperationCount: () => 0 }, contender, new StorageAccessGate({ paths, lock: contender }))
      await expect(maintenance.clearCache({ dryRun: false })).rejects.toMatchObject({ failure: { code: 'STORAGE_LOCKED' } })
    } finally { await lock.release() }
  })

  it('needs only the active-operation count capability', async () => {
    const { paths, results, lock, accessGate } = await maintenanceFixture()
    await publish(results, '7'.repeat(64), '# preserve')
    let activeCount = 1
    const maintenance = new StorageMaintenanceService(paths, results, { activeOperationCount: () => activeCount }, lock, accessGate)
    const blocked = await maintenance.clearCache()
    expect(blocked).toMatchObject({ eligible: false, activeOperationCount: 1 })
    expect(blocked.confirmationToken).toBeUndefined()
    await expect(maintenance.clearCache({ dryRun: false })).rejects.toMatchObject({ failure: { code: 'STORAGE_LOCKED' } })
    activeCount = 0
    expect(await maintenance.clearCache()).toMatchObject({ eligible: true, confirmationToken: expect.any(String) })
  })
})

describe('StorageMaintenanceService quarantine operations', () => {
  it('lists bounded quarantine entries and cleans only requested safe entries after dry run', async () => {
    const fixture = await maintenanceFixture()
    const { paths, maintenance } = fixture
    const published = await publish(fixture.results)
    const staging = await stageUnpublished(fixture, 'b'.repeat(64))
    for (let index = 0; index < 16; index++) await quarantineEntry(fixture, 'entry_' + String(index))
    const outside = join(paths.root, 'outside-quarantine.txt')
    await writeFile(outside, 'outside')
    await symlink(outside, join(paths.quarantineDir(), 'unsafe-link'))

    const listed = await maintenance.listQuarantine({ limit: 3 })
    expect(listed).toMatchObject({ totalCount: 16, truncated: true, skippedSymlinkCount: 1 })
    expect(listed.entries).toHaveLength(3)
    await expect(maintenance.cleanupQuarantine({ entryIds: ['../results'], dryRun: false })).rejects.toThrow(TypeError)
    expect(await maintenance.cleanupQuarantine({ entryIds: ['entry_0'] })).toMatchObject({ dryRun: true, plannedCount: 1, deletedCount: 0 })
    await exists(paths.quarantineDir('entry_0'))
    expect(await maintenance.cleanupQuarantine({ entryIds: ['entry_0'], dryRun: false })).toMatchObject({ dryRun: false, deletedCount: 1 })
    await absent(paths.quarantineDir('entry_0'))
    await exists(paths.quarantineDir('entry_1'))
    await exists(paths.resultDir(published.cacheKey))
    await exists(staging)
    expect(await readFile(outside, 'utf8')).toBe('outside')
  })

  it('refuses a symlinked quarantine root without touching its target', async () => {
    const { paths, maintenance } = await maintenanceFixture()
    const outside = await tempRoot()
    await mkdir(join(outside, 'entry_0'))
    await writeFile(join(outside, 'entry_0', 'payload.txt'), 'outside payload')
    await symlink(outside, paths.quarantineDir())
    expect(await maintenance.cleanupQuarantine({ entryIds: ['entry_0'], dryRun: false })).toMatchObject({ deletedCount: 0, skippedCount: 1 })
    expect(await readFile(join(outside, 'entry_0', 'payload.txt'), 'utf8')).toBe('outside payload')
  })

  it('removes verified result quarantine trees and preserves trees containing symlinks', async () => {
    const fixture = await maintenanceFixture()
    const { paths, results, maintenance } = fixture
    const published = await publish(results)
    await rm(paths.resolveArtifactPath(published.cacheKey, published.artifactPath))
    await expect(results.get(published.cacheKey)).rejects.toMatchObject({ failure: { code: 'CACHE_CORRUPT' } })
    expect((await maintenance.scanIntegrity({ isolateInvalid: true })).quarantinedCount).toBe(1)
    const [entry] = (await maintenance.listQuarantine()).entries
    expect((await maintenance.cleanupQuarantine({ entryIds: [entry!.id], dryRun: false })).deletedCount).toBe(1)
    await absent(paths.quarantineDir(entry!.id))

    const unsafe = await quarantineEntry(fixture, 'unsafe_entry')
    const outside = join(paths.root, 'outside-unsafe.txt')
    await writeFile(outside, 'safe outside')
    await symlink(outside, join(unsafe, 'payload-link'))
    expect(await maintenance.cleanupQuarantine({ entryIds: ['unsafe_entry'], dryRun: false })).toMatchObject({ plannedCount: 0, skippedCount: 1 })
    await exists(unsafe)
    expect(await readFile(outside, 'utf8')).toBe('safe outside')
  })
})

describe('StorageMaintenanceService cache clear confirmation', () => {
  it('previews, then deletes every published result with the preview token', async () => {
    const { paths, results, maintenance } = await maintenanceFixture()
    const first = await publish(results, 'a'.repeat(64), '# first')
    const second = await publish(results, 'b'.repeat(64), '# second')
    const preview = await maintenance.clearCache()
    expect(preview).toMatchObject({ dryRun: true, eligible: true, plannedCount: 2, deletedCount: 0 })
    await exists(paths.resultDir(first.cacheKey))
    const cleared = await maintenance.clearCache({ dryRun: false, confirmationToken: preview.confirmationToken })
    expect(cleared).toMatchObject({ eligible: true, deletedCount: 2, skippedCount: 0 })
    expect(cleared.deletedBytes).toBeGreaterThan(0)
    await absent(paths.resultDir(first.cacheKey))
    await absent(paths.resultDir(second.cacheKey))
  })

  it.each([undefined, 'wrong-token'])('refuses deletion without the matching token (%s)', async confirmationToken => {
    const { paths, results, maintenance } = await maintenanceFixture()
    const published = await publish(results)
    expect(await maintenance.clearCache({ dryRun: false, confirmationToken })).toMatchObject({ eligible: false, deletedCount: 0 })
    await exists(paths.resultDir(published.cacheKey))
  })

  it('rejects a stale preview token when the result set changed', async () => {
    const { paths, results, maintenance } = await maintenanceFixture()
    const first = await publish(results, 'f'.repeat(64), '# first')
    const preview = await maintenance.clearCache()
    const second = await publish(results, '1'.repeat(64), '# second')
    expect(await maintenance.clearCache({ dryRun: false, confirmationToken: preview.confirmationToken }))
      .toMatchObject({ eligible: false, deletedCount: 0 })
    await exists(paths.resultDir(first.cacheKey))
    await exists(paths.resultDir(second.cacheKey))
  })

  it('fails closed on a truncated traversal even with a matching complete-preview token', async () => {
    const { paths, results, maintenance } = await maintenanceFixture()
    const first = await publish(results, 'a'.repeat(64), '# first')
    const second = await publish(results, 'b'.repeat(64), '# second')
    const preview = await maintenance.clearCache()
    const report = await maintenance.clearCache({ dryRun: false, resultLimit: 1, confirmationToken: preview.confirmationToken })
    expect(report).toMatchObject({ scan: { scanned: 1, truncated: true }, eligible: false, deletedCount: 0 })
    expect(report.confirmationToken).toBeUndefined()
    await exists(paths.resultDir(first.cacheKey))
    await exists(paths.resultDir(second.cacheKey))
  })

  it('fails closed for every planned result when any prefix is a symlink', async () => {
    const { paths, results, maintenance } = await maintenanceFixture()
    const published = await publish(results, '5'.repeat(64), '# preserve')
    const preview = await maintenance.clearCache()
    const outside = await tempRoot()
    await writeFile(join(outside, 'preserve.txt'), 'outside')
    const prefix = ['00', '01'].find(value => value !== published.cacheKey.slice(0, 2))!
    await symlink(outside, join(paths.resultsDir(), prefix))
    const report = await maintenance.clearCache({ dryRun: false, confirmationToken: preview.confirmationToken })
    expect(report).toMatchObject({ eligible: false, deletedCount: 0 })
    expect(report.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'symlink-skipped' })]))
    expect(await readFile(join(outside, 'preserve.txt'), 'utf8')).toBe('outside')
    await exists(paths.resultDir(published.cacheKey))
  })

  it('withholds a preview token behind a symlinked results ancestor', async () => {
    const { paths, results, maintenance } = await maintenanceFixture()
    const published = await publish(results, '2'.repeat(64), '# ancestor')
    const outside = join(paths.root, 'outside-results')
    await mkdir(outside)
    await rename(paths.resultsDir(), join(outside, 'sha256'))
    await rm(join(paths.root, 'results'), { recursive: true })
    await symlink(outside, join(paths.root, 'results'))
    const report = await maintenance.clearCache()
    expect(report.eligible).toBe(false)
    expect(report.confirmationToken).toBeUndefined()
    await exists(paths.resultDir(published.cacheKey))
  })

  it('never follows symlinks inside a published result while clearing', async () => {
    const { paths, results, maintenance } = await maintenanceFixture()
    const published = await publish(results, 'd'.repeat(64), '# linked')
    const outside = join(paths.root, 'outside-cache.txt')
    await writeFile(outside, 'preserve me')
    await symlink(outside, join(paths.fileDir(published.cacheKey, published.fileId), 'outside-link'))
    expect(await maintenance.clearCache({ dryRun: false })).toMatchObject({ eligible: false, deletedCount: 0, skippedCount: 1 })
    expect(await readFile(outside, 'utf8')).toBe('preserve me')
    await exists(paths.resultDir(published.cacheKey))
  })
})
