import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { maintenanceFixture, publish } from './support/storage-fixtures.js'

describe('cross-process storage access', () => {
  it('blocks clear while another process holds a reader record and resumes only after it is dead', async () => {
    const { root, lock, results, maintenance } = await maintenanceFixture({ lock: { acquireTimeoutMs: 250, pollIntervalMs: 10 } })
    await lock.initialize()
    const published = await publish(results)
    const child = spawn(process.execPath, [join(import.meta.dirname, 'helpers/storage-user.mjs'), root], {
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    try {
      await once(child.stdout!, 'data')
      const blockedPreview = await maintenance.clearCache()
      await expect(maintenance.clearCache({ dryRun: false, confirmationToken: blockedPreview.confirmationToken ?? 'none' }))
        .rejects.toMatchObject({ failure: { code: 'STORAGE_LOCKED' } })
    } finally {
      child.kill('SIGKILL')
      await once(child, 'exit')
    }
    const preview = await maintenance.clearCache()
    await expect(maintenance.clearCache({ dryRun: false, confirmationToken: preview.confirmationToken }))
      .resolves.toMatchObject({ deletedCount: 1 })
    await expect(results.get(published.cacheKey)).resolves.toBeUndefined()
  })
})
