import type { Context } from '@deepseek-ai/cordis'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.js'
import { SettingsPage } from '../src/client/SettingsPage.js'
import { en, NS, zh } from '../src/client/locales.js'

// Use the published registry core to validate the actual registration shape.
// The context boundary captures declaration injection; browser verification
// exercises the real SlotRegistry and plugin-manager rendering lifecycle.
function fixture() {
  const core = new SlotCore()
  const removeLocale = vi.fn()
  const registerLocale = vi.fn(() => removeLocale)
  const effects: Array<() => void> = []
  const rpc = { call: vi.fn() }
  const credentials = { describe: vi.fn(), set: vi.fn(), unset: vi.fn() }
  const inject = vi.fn((_name: string, _install: () => () => void) => undefined)
  const ctx = {
    effect: (install: () => () => void) => { effects.push(install()) },
    locale: { register: registerLocale },
    get: (name: string) => name === 'connection' ? { rpc } : undefined,
    remote: { credentials },
    slots: { inject, register: core.register.bind(core) },
  } as unknown as Context
  const declare = () => core.register({
    name: 'root',
    children: { 'plugins.bundle.config': { kind: 'keyed', scope: 'root' } },
  }, () => null)
  return { core, ctx, declare, inject, registerLocale, removeLocale, effects, rpc, credentials }
}

describe('bundle configuration registration', () => {
  it('waits for the bundle slot and registers only under its package key', () => {
    const f = fixture()
    apply(f.ctx)
    expect(f.inject).toHaveBeenCalledOnce()
    const [name, install] = f.inject.mock.calls[0]!
    expect(name).toBe('plugins.bundle.config')
    expect(f.core.entriesOfSlot(name)).toHaveLength(0)

    const removeOwner = f.declare()
    const removePage = install()
    const entries = f.core.entriesOfSlot(name)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.options).toMatchObject({ key: 'dsh-pdf-mineru' })
    expect(entries[0]!.options.id).toBeUndefined()
    expect(entries[0]!.options.label).toBeUndefined()
    expect(entries[0]!.component).toBe(SettingsPage)
    expect(entries[0]!.locale).toBe(NS)
    expect(entries[0]!.inject?.()).toEqual({ rpc: f.rpc, credentials: f.credentials })
    expect(f.core.entriesOfSlot('settings.section')).toHaveLength(0)
    expect(f.registerLocale).toHaveBeenCalledWith(NS, { zh, en })
    expect(f.rpc.call).not.toHaveBeenCalled()

    removePage()
    expect(f.core.entriesOfSlot(name)).toHaveLength(0)
    removeOwner()
    for (const dispose of f.effects) dispose()
    expect(f.removeLocale).toHaveBeenCalledOnce()
  })

  it('can register again after the owner collapses and redeclares the slot', () => {
    const f = fixture()
    apply(f.ctx)
    const [, install] = f.inject.mock.calls[0]!
    const removeOwner = f.declare()
    const staleDispose = install()
    removeOwner()
    expect(f.core.entriesOfSlot('plugins.bundle.config')).toHaveLength(0)
    const removeNextOwner = f.declare()
    const removeNextPage = install()
    staleDispose()
    expect(f.core.entriesOfSlot('plugins.bundle.config')).toHaveLength(1)
    removeNextPage()
    removeNextOwner()
    for (const dispose of f.effects) dispose()
  })
})
