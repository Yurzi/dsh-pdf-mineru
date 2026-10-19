import { describe, expect, it, vi } from 'vitest'
import { rpcErrorSchema } from '@deepseek-ai/dsh-client-connection'
import { defaultMinerUConfig } from '../src/config/parse.js'
import type { ProbeView } from '../src/contracts/probe.js'
import type { StorageStatistics } from '../src/contracts/maintenance.js'
import { RPC_ENDPOINTS } from '../src/contracts/rpc.js'
import { failure, MinerUError, type MinerUErrorCode } from '../src/domain/errors.js'
import { mapRpcError } from '../src/rpc.js'
import { cacheClearReport, cleanupReport, integrityReport, nonOwnerPeer, rpcHarness } from './support/rpc-harness.js'

const invalidArgument = { ok: false, error: { code: 'mineru/invalid-argument' } }

describe('MinerU RPC authorization', () => {
  it.each([...Object.values(RPC_ENDPOINTS), 'mineru/unknown'])('rejects a non-owner %s before parsing or dependencies', async endpoint => {
    const h = rpcHarness()
    const payload = new Proxy({}, { get() { throw new Error('payload must not be read') } })
    expect(await h.call(endpoint, payload, nonOwnerPeer())).toEqual({
      ok: false, error: { code: 'mineru/forbidden', message: 'Owner access required', details: {} },
    })
    for (const dependency of [h.deps.settings.current, h.deps.settings.save, h.deps.probe, ...Object.values(h.deps.maintenance)]) {
      expect(dependency).not.toHaveBeenCalled()
    }
  })

  it.each(['mineru/unknown_action', 'mineru/storage.gc.preview', 'toString', '__proto__'])('returns mineru/not-found for %s', async endpoint => {
    expect(await rpcHarness().call(endpoint)).toMatchObject({ ok: false, error: { code: 'mineru/not-found' } })
  })
})

describe('MinerU RPC configuration', () => {
  it('returns the current configuration with its settings revision', async () => {
    const config = defaultMinerUConfig()
    const h = rpcHarness({ settings: { current: vi.fn(() => ({ config, revision: 3 })) } })
    expect(await h.call('mineru/config.get')).toEqual({ ok: true, value: { config, revision: 3 } })
  })

  it('forwards config and expected revision unchanged and maps validation and conflict failures', async () => {
    const config = defaultMinerUConfig()
    const save = vi.fn(async () => ({ config, revision: 5 }))
    const h = rpcHarness({ settings: { save } })
    const raw = { schemaVersion: 2, historical: true }
    expect(await h.call('mineru/config.set', { config: raw })).toEqual({ ok: true, value: { config, revision: 5 } })
    expect(save).toHaveBeenLastCalledWith(raw, undefined)
    expect(await h.call('mineru/config.set', { config: raw, expected_revision: 0 })).toMatchObject({ ok: true })
    expect(save).toHaveBeenLastCalledWith(raw, 0)
    save.mockRejectedValueOnce(new TypeError('invalid configuration'))
    expect(await h.call('mineru/config.set', { config: raw })).toMatchObject(invalidArgument)
    save.mockRejectedValueOnce(new MinerUError(failure('SETTINGS_CONFLICT', 'MinerU settings changed since they were read')))
    expect(await h.call('mineru/config.set', { config: raw, expected_revision: 4 })).toMatchObject({ ok: false, error: { code: 'mineru/conflict' } })
  })

  it.each([
    {}, [], 'config', { config: undefined }, { config: null },
    ...[-1, 1.5, '4', null, Number.MAX_SAFE_INTEGER + 1].map(expected_revision => ({ config: {}, expected_revision })),
  ])('rejects malformed config.set payload %j before persistence', async payload => {
    const h = rpcHarness()
    expect(await h.call('mineru/config.set', payload)).toMatchObject(invalidArgument)
    expect(h.deps.settings.save).not.toHaveBeenCalled()
  })

  it('probes an unsaved draft provider without saving settings', async () => {
    const view: ProbeView = { available: true, provider: 'official-v4', authentication: 'valid', protocol_version: '4.0' }
    const h = rpcHarness({ probe: vi.fn(async () => view) })
    const draft = { id: 'mp_draft', type: 'official-v4', baseURL: 'https://mineru.net/api/v4', apiKeyEnv: 'TEST_KEY' }
    expect(await h.call('mineru/probe', { provider: draft })).toEqual({ ok: true, value: view })
    expect(h.deps.probe).toHaveBeenCalledExactlyOnceWith(draft, h.signal)
    expect(await h.call('mineru/probe', 'not-an-object')).toMatchObject(invalidArgument)
    expect(h.deps.probe).toHaveBeenCalledOnce()
    expect(h.deps.settings.save).not.toHaveBeenCalled()
  })
})

describe('MinerU RPC maintenance', () => {
  it('exposes read-only storage statistics with the caller signal', async () => {
    const h = rpcHarness()
    const full: StorageStatistics = { generatedAt: 1, publishedResults: area(), staging: area(), quarantine: area() }
    h.deps.maintenance.getStatistics.mockResolvedValue(full)
    expect(await h.call('mineru/storage.stats')).toEqual({ ok: true, value: full })
    expect(h.deps.maintenance.getStatistics).toHaveBeenCalledWith(h.signal)
  })

  it.each([
    ['mineru/storage.quarantine.cleanup', { entry_ids: ['entry_1'], dry_run: false }, 'cleanupQuarantine'],
    ['mineru/storage.quarantine.cleanup', { entry_ids: 'entry_1', dry_run: true, confirm: true }, 'cleanupQuarantine'],
    ['mineru/storage.cache.clear', { dry_run: false, confirmation_token: 'preview-token' }, 'clearCache'],
    ['mineru/storage.cache.clear', { dry_run: false, confirm: true }, 'clearCache'],
    ['mineru/storage.cache.clear', { dry_run: false, confirm: true, confirmation_token: '' }, 'clearCache'],
    ['mineru/storage.cache.clear', { dry_run: 'false', confirm: true, confirmation_token: 'preview-token' }, 'clearCache'],
    ['mineru/storage.integrity.scan', { isolate_invalid: true }, 'scanIntegrity'],
    ['mineru/storage.integrity.scan', { isolate_invalid: true, confirm: 'yes' }, 'scanIntegrity'],
    ['mineru/storage.integrity.scan', { result_limit: 0 }, 'scanIntegrity'],
  ] as const)('refuses %s %j without explicit confirmation or valid arguments', async (endpoint, payload, method) => {
    const h = rpcHarness()
    expect(await h.call(endpoint, payload)).toMatchObject(invalidArgument)
    expect(h.deps.maintenance[method]).not.toHaveBeenCalled()
  })

  it('forwards confirmed destructive maintenance with explicit options', async () => {
    const h = rpcHarness()
    const cleanup = cleanupReport()
    const preview = cacheClearReport()
    const isolation = integrityReport()
    h.deps.maintenance.cleanupQuarantine.mockResolvedValue(cleanup)
    h.deps.maintenance.clearCache.mockResolvedValue(preview)
    h.deps.maintenance.scanIntegrity.mockResolvedValue(isolation)
    const signal = h.signal

    expect(await h.call('mineru/storage.quarantine.cleanup', { entry_ids: ['entry_1'], dry_run: false, confirm: true })).toEqual({ ok: true, value: cleanup })
    expect(h.deps.maintenance.cleanupQuarantine).toHaveBeenCalledWith({ entryIds: ['entry_1'], dryRun: false, signal })
    expect(await h.call('mineru/storage.cache.clear', { result_limit: 50, diagnostic_limit: 10 })).toEqual({ ok: true, value: preview })
    expect(h.deps.maintenance.clearCache).toHaveBeenLastCalledWith({ resultLimit: 50, diagnosticLimit: 10, dryRun: true, signal })
    expect(await h.call('mineru/storage.cache.clear', { dry_run: false, confirm: true, confirmation_token: 'preview-token' })).toMatchObject({ ok: true })
    expect(h.deps.maintenance.clearCache).toHaveBeenLastCalledWith({
      resultLimit: undefined, diagnosticLimit: undefined, dryRun: false, confirmationToken: 'preview-token', signal,
    })
    expect(await h.call('mineru/storage.integrity.scan', { isolate_invalid: true, confirm: true })).toEqual({ ok: true, value: isolation })
    expect(h.deps.maintenance.scanIntegrity).toHaveBeenCalledWith({ resultLimit: undefined, diagnosticLimit: undefined, isolateInvalid: true, signal })
  })
})

describe('MinerU RPC error mapping', () => {
  it('returns schema-valid allowlisted errors and redacts probe failures', async () => {
    const h = rpcHarness({ probe: vi.fn(async () => {
      throw new Error('Connection failed: Bearer secret_token_12345 to https://user:p%40ss@secret.host/token/path?token=abc#fragment')
    }) })
    const result = await h.call('mineru/probe')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(rpcErrorSchema.safeParse(result.error).success).toBe(true)
    expect(result.error).toMatchObject({ code: 'mineru/internal', message: expect.stringContaining('Bearer [REDACTED]') })
    for (const secret of ['secret_token_12345', 'user', 'p%40ss', '/token/path', 'token=abc', 'fragment']) {
      expect(result.error.message).not.toContain(secret)
    }
    h.deps.probe.mockRejectedValueOnce(new MinerUError(failure('STORAGE_LOCKED', 'Storage is locked')))
    expect(await h.call('mineru/probe')).toEqual({ ok: false, error: { code: 'mineru/storage-locked', message: 'Storage is locked', details: {} } })
  })

  it.each<[MinerUErrorCode, string]>([
    ['CREDENTIAL_MISSING', 'mineru/credential-missing'],
    ['AUTHENTICATION_FAILED', 'mineru/auth-failed'],
    ['PROVIDER_RATE_LIMITED', 'mineru/provider-rate-limited'],
    ['STORAGE_LOCKED', 'mineru/storage-locked'],
    ['SETTINGS_CONFLICT', 'mineru/conflict'],
    ['CANCELLED', 'mineru/cancelled'],
  ])('maps %s to %s', (code, rpcCode) => {
    expect(mapRpcError(new MinerUError(failure(code, 'message')))).toEqual({ code: rpcCode, message: 'message' })
  })

  it('maps TypeError and AbortError and redacts their messages', () => {
    expect(mapRpcError(new TypeError('bad Bearer token_secret_123'))).toEqual({ code: 'mineru/invalid-argument', message: 'bad Bearer [REDACTED]' })
    expect(mapRpcError(new DOMException('aborted', 'AbortError'))).toEqual({ code: 'mineru/cancelled', message: 'aborted' })
  })
})

function area(): StorageStatistics['staging'] {
  return {
    byteUsage: 0, logicalEntryCount: 0, regularFileCount: 0, directoryCount: 0, skippedSymlinkCount: 0,
    unexpectedEntryCount: 0, unreadableEntryCount: 0, depthLimitCount: 0, truncated: false, complete: true,
  }
}
