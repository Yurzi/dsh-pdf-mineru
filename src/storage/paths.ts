/**
 * paths.ts — Validated filesystem layout and path derivation for MinerU storage.
 *
 * Enforces:
 *   - Strict identifier validation before path concatenation (prevents path traversal)
 *   - Relative POSIX artifact path containment within result/staging roots
 *   - Safe, deterministic directory layout per ARCHITECTURE.md §12.4
 */

import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import {
  asCacheKey,
  asFileId,
  asOperationId,
  assertSafePathSegment,
  type CacheKey,
  type MinerUFileId,
  type OperationId,
} from '../domain/ids.js'
import { assertSafeArtifactRelativePath } from '../domain/schemas.js'

export function defaultStorageRoot(): string {
  const configured = process.env.DSH_HOME?.trim()
  const dshHome = !configured
    ? join(homedir(), '.dsh')
    : configured === '~'
      ? homedir()
      : configured.startsWith('~/') || configured.startsWith('~\\')
        ? resolve(join(homedir(), configured.slice(2)))
        : resolve(configured)
  return join(dshHome, 'cache', 'pdf-mineru')
}

export class StoragePaths {
  readonly root: string

  constructor(root: string = defaultStorageRoot()) {
    if (!root || typeof root !== 'string' || root.trim() === '') {
      throw new TypeError('Storage root path must be a non-empty string')
    }
    this.root = resolve(root)
  }

  resultsDir(): string {
    return join(this.root, 'results', 'sha256')
  }

  resultDir(cacheKey: CacheKey | string): string {
    const key = asCacheKey(cacheKey)
    return join(this.resultsDir(), key.slice(0, 2), key)
  }

  manifestFile(cacheKey: CacheKey | string): string {
    return join(this.resultDir(cacheKey), 'manifest.json')
  }

  filesDir(cacheKey: CacheKey | string): string {
    return join(this.resultDir(cacheKey), 'files')
  }

  fileDir(cacheKey: CacheKey | string, fileId: MinerUFileId | string): string {
    const fid = asFileId(fileId)
    return join(this.filesDir(cacheKey), fid)
  }

  stagingDir(operationId?: OperationId | string): string {
    if (operationId === undefined) {
      return join(this.root, 'staging')
    }
    const op = asOperationId(operationId)
    return join(this.root, 'staging', op)
  }

  stagingFilesDir(operationId: OperationId | string): string {
    return join(this.stagingDir(operationId), 'files')
  }

  stagingFileDir(operationId: OperationId | string, fileId: MinerUFileId | string): string {
    const fid = asFileId(fileId)
    return join(this.stagingFilesDir(operationId), fid)
  }

  stagingTempDir(operationId: OperationId | string): string {
    return join(this.stagingDir(operationId), 'temp')
  }

  stagingManifestFile(operationId: OperationId | string): string {
    return join(this.stagingDir(operationId), 'manifest.json')
  }

  quarantineDir(name?: string): string {
    if (name === undefined) {
      return join(this.root, 'quarantine')
    }
    const safeName = assertSafePathSegment(name, 'quarantine name')
    return join(this.root, 'quarantine', safeName)
  }

  processLockFile(): string {
    return join(this.root, '.process.lock')
  }

  resolveArtifactPath(cacheKey: CacheKey | string, relativePath: string): string {
    assertSafeArtifactRelativePath(relativePath)
    const base = this.resultDir(cacheKey)
    const target = resolve(base, relativePath)
    if (!target.startsWith(base + sep)) {
      throw new TypeError(`artifact relative path "${relativePath}" escapes result directory`)
    }
    return target
  }

  resolveStagingArtifactPath(operationId: OperationId | string, relativePath: string): string {
    assertSafeArtifactRelativePath(relativePath)
    const base = this.stagingDir(operationId)
    const target = resolve(base, relativePath)
    if (!target.startsWith(base + sep)) {
      throw new TypeError(`artifact relative path "${relativePath}" escapes staging directory`)
    }
    return target
  }
}
