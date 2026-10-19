/** Privileged loopback-only maintenance. All destructive work holds exclusive scoped storage access. */
import { throwMinerU } from '../../domain/errors.js'
import type { StorageStatistics, IntegrityScanOptions, CacheIntegrityScanReport, QuarantineListOptions, QuarantineListReport, QuarantineCleanupOptions, QuarantineCleanupReport, CacheClearOptions, CacheClearReport } from '../../contracts/maintenance.js'
import type { StorageAccessGate } from '../access-gate.js'
import type { StoragePaths } from '../paths.js'
import type { ProcessLock } from '../process-lock.js'
import type { ResultRepository } from '../result-repository.js'
import type { ActiveOperations } from './active-operations.js'
import { getStatistics } from './statistics.js'
import { scanIntegrity } from './integrity.js'
import { listQuarantine, cleanupQuarantine } from './quarantine.js'
import { clearCache } from './cache-clear.js'

export class StorageMaintenanceService {
  constructor(
    public readonly paths: StoragePaths,
    public readonly results: ResultRepository,
    public readonly operations: ActiveOperations,
    public readonly lock: ProcessLock,
    public readonly accessGate: StorageAccessGate,
  ) {}

  async getStatistics(signal?: AbortSignal): Promise<StorageStatistics> {
    return await getStatistics(this.paths, signal)
  }

  async scanIntegrity(options: IntegrityScanOptions = {}): Promise<CacheIntegrityScanReport> {
    if (options.isolateInvalid !== true) return await scanIntegrity(this.paths, this.results, this.lock, options)

    return await this.accessGate.runMaintenance(async scope => {
      this.assertNoLocalOperations()
      return await scanIntegrity(this.paths, this.results, this.lock, options, scope)
    }, options.signal)
  }

  async listQuarantine(options: QuarantineListOptions = {}): Promise<QuarantineListReport> {
    return await listQuarantine(this.paths, options)
  }

  async cleanupQuarantine(options: QuarantineCleanupOptions): Promise<QuarantineCleanupReport> {
    if (options.dryRun !== false) return await cleanupQuarantine(this.paths, options)

    return await this.accessGate.runMaintenance(async () => {
      this.assertNoLocalOperations()
      return await cleanupQuarantine(this.paths, options)
    }, options.signal)
  }

  async clearCache(options: CacheClearOptions = {}): Promise<CacheClearReport> {
    if (options.dryRun !== false) {
      return await clearCache(this.paths, this.operations, options, false, this.accessGate.activeReaderCount)
    }

    return await this.accessGate.runMaintenance(async () => {
      this.assertNoLocalOperations()
      return await clearCache(this.paths, this.operations, options, true, 0)
    }, options.signal)
  }

  private assertNoLocalOperations(): void {
    if (this.operations.activeOperationCount() > 0) {
      throwMinerU('STORAGE_LOCKED', 'MinerU storage is in use by an active parse operation')
    }
  }
}
