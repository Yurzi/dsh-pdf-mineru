import { lstat, rm } from 'node:fs/promises'
import type { QuarantineEntry, QuarantineListOptions, QuarantineListReport, QuarantineCleanupOptions, QuarantineCleanupReport } from '../../contracts/maintenance.js'
import { assertSafePathSegment } from '../../domain/ids.js'
import type { StoragePaths } from '../paths.js'
import { boundedLimit, DEFAULT_QUARANTINE_LIST_LIMIT, MAX_QUARANTINE_LIST_LIMIT } from './limits.js'
import { readSafeDirectory, isSafeSegment, classifyNode, collectUsage, isSafeExistingDirectoryChain } from './fs-safety.js'

const MAX_QUARANTINE_CLEANUP_ENTRIES = 100

export async function listQuarantine(paths: StoragePaths, options: QuarantineListOptions = {}): Promise<QuarantineListReport> {
  const limit = boundedLimit(options.limit, DEFAULT_QUARANTINE_LIST_LIMIT, MAX_QUARANTINE_LIST_LIMIT, 'limit')
  const entries: QuarantineEntry[] = []
  let totalBytes = 0
  let totalCount = 0
  let skippedSymlinkCount = 0
  let unexpectedEntryCount = 0
  let unreadableEntryCount = 0

  const root = await readSafeDirectory(paths.quarantineDir())
  if (root.kind === 'entries') {
    for (const entry of root.entries) {
      options.signal?.throwIfAborted()
      if (!isSafeSegment(entry.name)) {
        unexpectedEntryCount++
        continue
      }
      if (entry.isSymbolicLink()) {
        skippedSymlinkCount++
        continue
      }
      const entryPath = paths.quarantineDir(entry.name)
      const kind = await classifyNode(entryPath)
      if (kind === 'symlink') {
        skippedSymlinkCount++
        continue
      }
      if (kind === 'unreadable') {
        unreadableEntryCount++
        continue
      }
      if (kind !== 'directory') {
        if (kind !== 'missing') unexpectedEntryCount++
        continue
      }

      const usage = await collectUsage(entryPath, options.signal)
      const details = await lstat(entryPath).catch(() => undefined)
      if (details === undefined || details.isSymbolicLink() || !details.isDirectory()) {
        unreadableEntryCount++
        continue
      }
      totalCount++
      totalBytes += usage.bytes
      if (entries.length < limit) {
        entries.push({
          id: entry.name,
          byteUsage: usage.bytes,
          regularFileCount: usage.regularFileCount,
          directoryCount: usage.directoryCount,
          modifiedAt: Math.max(0, Math.floor(details.mtimeMs)),
        })
      }
    }
  } else if (root.kind === 'symlink') {
    skippedSymlinkCount++
  } else if (root.kind === 'unreadable') {
    unreadableEntryCount++
  } else if (root.kind === 'unexpected') {
    unexpectedEntryCount++
  }

  return {
    generatedAt: Date.now(),
    entries,
    totalCount,
    totalBytes,
    truncated: (root.kind === 'entries' && root.truncated) || totalCount > entries.length,
    skippedSymlinkCount,
    unexpectedEntryCount,
    unreadableEntryCount,
  }
}

export async function cleanupQuarantine(paths: StoragePaths, options: QuarantineCleanupOptions): Promise<QuarantineCleanupReport> {
  if (options.entryIds.length > MAX_QUARANTINE_CLEANUP_ENTRIES) {
    throw new TypeError(`entryIds cannot contain more than ${MAX_QUARANTINE_CLEANUP_ENTRIES} entries`)
  }

  const entryIds: string[] = []
  const seen = new Set<string>()
  for (const entryId of options.entryIds) {
    const safeId = assertSafePathSegment(entryId, 'quarantine entry ID')
    if (!seen.has(safeId)) {
      seen.add(safeId)
      entryIds.push(safeId)
    }
  }

  const dryRun = options.dryRun !== false
  const quarantineRoot = await readSafeDirectory(paths.quarantineDir())
  if (quarantineRoot.kind !== 'entries') {
    const rootMissing = quarantineRoot.kind === 'missing'
    return {
      generatedAt: Date.now(),
      dryRun,
      requestedCount: entryIds.length,
      plannedCount: 0,
      plannedBytes: 0,
      deletedCount: 0,
      deletedBytes: 0,
      missingCount: rootMissing ? entryIds.length : 0,
      skippedCount: rootMissing ? 0 : entryIds.length,
      entries: [],
    }
  }

  const plannedEntries: QuarantineEntry[] = []
  let plannedBytes = 0
  let deletedBytes = 0
  let deletedCount = 0
  let missingCount = 0
  let skippedCount = 0

  for (const entryId of entryIds) {
    options.signal?.throwIfAborted()
    const entryPath = paths.quarantineDir(entryId)
    const kind = await classifyNode(entryPath)
    if (kind === 'missing') {
      missingCount++
      continue
    }
    if (kind !== 'directory') {
      skippedCount++
      continue
    }

    const usage = await collectUsage(entryPath, options.signal)
    const details = await lstat(entryPath).catch(() => undefined)
    if (details === undefined || details.isSymbolicLink() || !details.isDirectory()) {
      skippedCount++
      continue
    }

    if (usage.truncated || usage.depthLimitCount > 0 || usage.skippedSymlinkCount > 0 || usage.unexpectedEntryCount > 0 || usage.unreadableEntryCount > 0) {
      // Preserve malformed quarantine trees for manual investigation.
      skippedCount++
      continue
    }

    const entry: QuarantineEntry = {
      id: entryId,
      byteUsage: usage.bytes,
      regularFileCount: usage.regularFileCount,
      directoryCount: usage.directoryCount,
      modifiedAt: Math.max(0, Math.floor(details.mtimeMs)),
    }
    plannedEntries.push(entry)
    plannedBytes += usage.bytes

    if (!dryRun) {
      try {
        if (!await isSafeExistingDirectoryChain(entryPath, options.signal)) {
          skippedCount++
          continue
        }
        await rm(entryPath, { recursive: true, force: true, maxRetries: 2 })
        deletedCount++
        deletedBytes += usage.bytes
      } catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') missingCount++
        else skippedCount++
      }
    }
  }

  return {
    generatedAt: Date.now(),
    dryRun,
    requestedCount: entryIds.length,
    plannedCount: plannedEntries.length,
    plannedBytes,
    deletedCount,
    deletedBytes,
    missingCount,
    skippedCount,
    entries: plannedEntries,
  }
}
