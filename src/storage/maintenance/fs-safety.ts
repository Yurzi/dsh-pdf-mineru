/** Storage-local filesystem inspection. Never follow symlinks; reject incomplete trees before deletion. */
import type { Dirent } from 'node:fs'
import { lstat, opendir, realpath } from 'node:fs/promises'
import { basename, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { assertSafePathSegment } from '../../domain/ids.js'

export const MAX_STATS_ENTRIES = 50_000
const MAX_STATS_DEPTH = 16
export const MAX_STATS_TIME_MS = 2_000

export type NodeKind = 'missing' | 'directory' | 'file' | 'symlink' | 'unexpected' | 'unreadable'

export type SafeDirectory =
  | { readonly kind: 'missing' | 'symlink' | 'unexpected' | 'unreadable' }
  | { readonly kind: 'entries'; readonly entries: readonly Dirent[]; readonly truncated: boolean }

export interface UsageCounter {
  bytes: number
  regularFileCount: number
  directoryCount: number
  skippedSymlinkCount: number
  unexpectedEntryCount: number
  unreadableEntryCount: number
  depthLimitCount: number
  truncated: boolean
  logicalEntryCount: number
}

function createUsage(): UsageCounter {
  return {
    bytes: 0,
    regularFileCount: 0,
    directoryCount: 0,
    skippedSymlinkCount: 0,
    unexpectedEntryCount: 0,
    unreadableEntryCount: 0,
    depthLimitCount: 0,
    truncated: false,
    logicalEntryCount: 0,
  }
}

export function isSafeSegment(value: string): boolean {
  try {
    assertSafePathSegment(value, 'storage entry')
    return true
  } catch {
    return false
  }
}

export async function classifyNode(path: string): Promise<NodeKind> {
  try {
    const details = await lstat(path)
    if (details.isSymbolicLink()) return 'symlink'
    if (details.isDirectory()) return 'directory'
    if (details.isFile()) return 'file'
    return 'unexpected'
  } catch (error) {
    return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT' ? 'missing' : 'unreadable'
  }
}

export function isWithinDirectory(target: string, parentDir: string): boolean {
  const rel = relative(resolve(parentDir), resolve(target))
  return !rel.startsWith('..') && !isAbsolute(rel)
}

export async function isSafeExistingDirectoryChain(target: string, signal?: AbortSignal): Promise<boolean> {
  const absolute = resolve(target)
  const root = parse(absolute).root
  const segments = absolute.slice(root.length).split(sep).filter(Boolean)
  let current = root
  for (const segment of segments) {
    signal?.throwIfAborted()
    current = join(current, segment)
    if (await classifyNode(current) !== 'directory') return false
  }
  try {
    return await realpath(absolute) === absolute
  } catch {
    return false
  }
}

async function isSafeReadableRoot(path: string, signal?: AbortSignal): Promise<boolean> {
  const absolute = resolve(path)
  const filesystemRoot = parse(absolute).root
  const segments = absolute.slice(filesystemRoot.length).split(sep).filter(Boolean)
  let current = filesystemRoot
  for (const segment of segments) {
    signal?.throwIfAborted()
    current = join(current, segment)
    try {
      const details = await lstat(current)
      if (details.isSymbolicLink() || !details.isDirectory()) return false
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return true
      return false
    }
  }
  return true
}

export async function readSafeDirectory(path: string, signal?: AbortSignal): Promise<SafeDirectory> {
  if (!await isSafeReadableRoot(path, signal)) return { kind: 'unreadable' }
  const kind = await classifyNode(path)
  if (kind !== 'directory') return { kind: kind === 'file' ? 'unexpected' : kind }
  try {
    const directory = await opendir(path)
    const entries: Dirent[] = []
    for await (const entry of directory) {
      entries.push(entry)
      if (entries.length > MAX_STATS_ENTRIES) break
    }
    entries.sort((left, right) => left.name.localeCompare(right.name))
    return { kind: 'entries', entries, truncated: entries.length > MAX_STATS_ENTRIES }
  } catch (error) {
    return { kind: (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT' ? 'missing' : 'unreadable' }
  }
}

export async function collectUsage(
  root: string,
  signal?: AbortSignal,
  logicalDepth?: number,
  validateLogical: (value: string, path: string) => unknown = value => assertSafePathSegment(value, 'storage entry'),
): Promise<UsageCounter> {
  const usage = createUsage()
  if (!await isSafeReadableRoot(root, signal)) {
    usage.unreadableEntryCount++
    return usage
  }
  const deadline = Date.now() + MAX_STATS_TIME_MS
  let visited = 0

  const walk = async (path: string, depth = 0): Promise<void> => {
    if (visited >= MAX_STATS_ENTRIES || Date.now() > deadline) {
      usage.truncated = true
      return
    }
    if (depth > MAX_STATS_DEPTH) {
      usage.depthLimitCount++
      usage.truncated = true
      return
    }
    visited++
    signal?.throwIfAborted()
    const kind = await classifyNode(path)
    if (kind === 'missing') return
    if (kind === 'symlink') {
      usage.skippedSymlinkCount++
      return
    }
    if (kind === 'unreadable') {
      usage.unreadableEntryCount++
      return
    }
    if (kind === 'unexpected') {
      usage.unexpectedEntryCount++
      return
    }
    if (kind === 'file') {
      try {
        const details = await lstat(path)
        usage.regularFileCount++
        usage.bytes += details.size
      } catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') {
          usage.unreadableEntryCount++
        }
      }
      return
    }

    usage.directoryCount++
    if (logicalDepth === depth) {
      try { validateLogical(basename(path), path); usage.logicalEntryCount++ } catch { /* not a logical entry */ }
    }
    const directory = await readSafeDirectory(path, signal)
    if (directory.kind !== 'entries') {
      if (directory.kind === 'symlink') usage.skippedSymlinkCount++
      else if (directory.kind === 'unreadable') usage.unreadableEntryCount++
      else if (directory.kind === 'unexpected') usage.unexpectedEntryCount++
      return
    }

    if (directory.truncated) usage.truncated = true
    for (const entry of directory.entries.slice(0, MAX_STATS_ENTRIES)) {
      signal?.throwIfAborted()
      if (!isSafeSegment(entry.name)) {
        usage.unexpectedEntryCount++
        continue
      }
      if (entry.isSymbolicLink()) {
        usage.skippedSymlinkCount++
        continue
      }
      await walk(join(path, entry.name), depth + 1)
    }
  }

  await walk(root)
  return usage
}
