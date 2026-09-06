import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SharedOperationRegistry } from '../src/service/shared-operations.js'
import { ProcessLock, ResultRepository, StorageMaintenanceService, StoragePaths } from '../src/storage/index.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'mineru-storage-process-'))
  roots.push(value)
  return value
}

describe('cross-process storage access', () => {
  it('blocks clear while another process has a reader record and prunes only after ESRCH', async () => {
    const storageRoot = await root()
    const paths = new StoragePaths(storageRoot)
    const lock = new ProcessLock(paths, { acquireTimeoutMs: 250, pollIntervalMs: 10 })
    await lock.initialize()
    const results = new ResultRepository(paths, {}, lock)
    const maintenance = new StorageMaintenanceService(paths, results, new SharedOperationRegistry(), lock)
    const child = spawn(process.execPath, [join(import.meta.dirname, 'helpers/storage-user.mjs'), storageRoot], {
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    await once(child.stdout!, 'data')
    await expect(maintenance.clearCache({ dryRun: false }))
      .rejects.toMatchObject({ failure: { code: 'STORAGE_LOCKED' } })

    child.kill('SIGKILL')
    await once(child, 'exit')
    const preview = await maintenance.clearCache()
    await expect(maintenance.clearCache({ dryRun: false, confirmationToken: preview.confirmationToken }))
      .resolves.toMatchObject({ deletedCount: 0 })
  })

  it('does not traverse a startup staging-root symlink', async () => {
    const storageRoot = await root()
    const outside = await root()
    await writeFile(join(outside, 'preserve.txt'), 'preserve')
    await symlink(outside, join(storageRoot, 'staging'))
    const paths = new StoragePaths(storageRoot)
    const lock = new ProcessLock(paths)
    const repository = new ResultRepository(paths, {}, lock)
    expect(await repository.cleanupStaging(1)).toBe(0)
    expect(await readFile(join(outside, 'preserve.txt'), 'utf8')).toBe('preserve')
    expect((await stat(join(storageRoot, 'staging'))).isDirectory()).toBe(true)
  })
})
