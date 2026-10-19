import { basename, dirname } from 'node:path'
import type { StorageAreaStatistics, StorageStatistics } from '../../contracts/maintenance.js'
import { asCacheKey, asOperationId } from '../../domain/ids.js'
import type { StoragePaths } from '../paths.js'
import { collectUsage, type UsageCounter } from './fs-safety.js'

function toAreaStatistics(usage: UsageCounter): StorageAreaStatistics {
  return {
    byteUsage: usage.bytes,
    logicalEntryCount: usage.logicalEntryCount,
    regularFileCount: usage.regularFileCount,
    directoryCount: usage.directoryCount,
    skippedSymlinkCount: usage.skippedSymlinkCount,
    unexpectedEntryCount: usage.unexpectedEntryCount,
    unreadableEntryCount: usage.unreadableEntryCount,
    depthLimitCount: usage.depthLimitCount,
    truncated: usage.truncated,
    complete: !usage.truncated
      && usage.depthLimitCount === 0
      && usage.skippedSymlinkCount === 0
      && usage.unexpectedEntryCount === 0
      && usage.unreadableEntryCount === 0,
  }
}

export async function getStatistics(paths: StoragePaths, signal?: AbortSignal): Promise<StorageStatistics> {
  const [publishedUsage, stagingUsage, quarantineUsage] = await Promise.all([
    collectUsage(paths.resultsDir(), signal, 2, (value, path) => {
      const key = asCacheKey(value)
      if (basename(dirname(path)) !== key.slice(0, 2)) throw new TypeError('cache prefix mismatch')
    }),
    collectUsage(paths.stagingDir(), signal, 1, value => asOperationId(value)),
    collectUsage(paths.quarantineDir(), signal, 1),
  ])

  return {
    generatedAt: Date.now(),
    publishedResults: toAreaStatistics(publishedUsage),
    staging: toAreaStatistics(stagingUsage),
    quarantine: toAreaStatistics(quarantineUsage),
  }
}
