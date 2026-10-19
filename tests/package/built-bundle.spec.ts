import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { loaderFixture } from '../support/loader-fixture.js'

// Package project: the built host bundle must activate through the same Loader path as the source plugin.
const builtEntry = fileURLToPath(new URL('../../lib/index.js', import.meta.url))

it('activates the built bundle against native SettingsForms', async () => {
  const built = await import(builtEntry)
  expect(built).toMatchObject({ name: 'dsh-pdf-mineru', inject: expect.arrayContaining(['tools', 'jobs', 'settings', 'workingDirectory']) })
  expect('default' in built).toBe(false)
  const host = await loaderFixture({ plugin: built, transport: false })
  const descriptor = () => host.ctx.settings.describe().find(row => row.ns === 'mineru-custom')!
  expect(descriptor().autoGenerate).toBe(false)
  await host.ctx.settings.update('mineru-custom', { output: { maxInlineImages: 8 } })
  expect(descriptor().value).toMatchObject({ output: { maxInlineImages: 8 } })
  expect(host.registerTool).toHaveBeenCalledTimes(2)
})
