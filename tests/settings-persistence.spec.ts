import type { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { Config } from '../src/config/schema.js'
import { defaultMinerUConfig } from '../src/config/parse.js'
import { readRuntimeConfig } from '../src/plugin/settings-persistence.js'

/** Boundary-only fake: the integration suite covers actual Cordis publication and Settings writes. */
function runtime(effectiveConfig: unknown) {
  const resolveConfig = vi.fn(() => { throw new Error('runtime reads must not resolve candidates') })
  const raw = vi.fn(() => { throw new Error('runtime reads must not inspect raw candidates') })
  const ctx = { fiber: { effectiveConfig, get config() { return raw() }, get rawConfig() { return raw() }, resolveConfig } } as unknown as Context
  return { ctx, raw, resolveConfig }
}

it('unwraps nested volatile values from the effective config into independent validated snapshots', () => {
  const base = defaultMinerUConfig()
  const effective = Config(base)
  const host = runtime(effective)
  const first = readRuntimeConfig(host.ctx)
  expect(first).toEqual(base)
  Object.assign(first.providers[0]!, { apiKeyEnv: 'SNAPSHOT_ONLY' })
  Object.assign(first.storage, { cacheEnabled: false })
  expect(readRuntimeConfig(host.ctx)).toEqual(base)
  expect(host.raw).not.toHaveBeenCalled()
  expect(host.resolveConfig).not.toHaveBeenCalled()
})

it.each([undefined, null])('does not fall back to raw input when effectiveConfig is %s', value => {
  const host = runtime(value)
  expect(readRuntimeConfig(host.ctx)).toEqual(defaultMinerUConfig())
  expect(host.raw).not.toHaveBeenCalled()
  expect(host.resolveConfig).not.toHaveBeenCalled()
})

it('retains complete domain validation rather than trusting malformed effective values', () => {
  const base = defaultMinerUConfig()
  const host = runtime({ ...base, output: { ...base.output, maxInlineImages: 101 } })
  expect(() => readRuntimeConfig(host.ctx)).toThrow(/output.maxInlineImages/)
  expect(host.raw).not.toHaveBeenCalled()
  expect(host.resolveConfig).not.toHaveBeenCalled()
})
