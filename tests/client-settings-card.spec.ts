// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultMinerUConfig } from '../src/config.js'
import { apply } from '../src/client/index.js'
import { SettingsCard } from '../src/client/SettingsCard.js'
import { SettingsPage, type SettingsPageProps } from '../src/client/SettingsPage.js'
import { en, zh } from '../src/client/locales.js'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe('MinerU settings card', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  function fixture(dictionary = zh) {
    const config = defaultMinerUConfig()
    const call = vi.fn(async (_channel: string, endpoint: string, payload: { config: unknown }) => {
      if (endpoint === 'mineru/config.get') return { ok: true, value: { config } }
      if (endpoint === 'mineru/config.set') return { ok: true, value: { config: payload.config } }
      throw new Error(`Unexpected fixture RPC: ${endpoint}`)
    })
    const credentials = {
      describe: vi.fn(async (refs: string[]) => ({
        ok: true as const,
        value: Object.fromEntries(refs.map(ref => [ref, { configured: true, writable: true, source: 'file' }])),
      })),
      set: vi.fn(async () => ({ ok: true as const, value: undefined })),
      unset: vi.fn(async () => ({ ok: true as const, value: undefined })),
    }
    const props: SettingsPageProps = {
      t: key => dictionary[key as keyof typeof dictionary],
      rpc: { call } as unknown as SettingsPageProps['rpc'],
      credentials,
    }
    return { props, call, credentials }
  }

  async function render(props: SettingsPageProps) {
    await act(async () => root.render(createElement(SettingsCard, props)))
    return {
      card: container.querySelector('details')!,
      summary: container.querySelector('summary')!,
    }
  }

  it.each([zh, en])('starts collapsed with a localized summary and no duplicate title', async dictionary => {
    const { props } = fixture(dictionary)
    const { card, summary } = await render(props)
    expect(card.open).toBe(false)
    expect(summary.textContent).toContain(dictionary['page.title'])
    expect(summary.textContent).toContain(dictionary['card.description'])
    expect(container.querySelector('h2')).toBeNull()
    expect(container.querySelectorAll('input').length).toBeGreaterThan(0)
    summary.focus()
    expect(document.activeElement).toBe(summary)
    await act(async () => summary.click())
    expect(card.open).toBe(true)
    await act(async () => summary.click())
    expect(card.open).toBe(false)
  })

  it('preserves the mounted form and unsaved config/credential drafts across collapse', async () => {
    const { props, call, credentials } = fixture()
    const { card, summary } = await render(props)
    const input = container.querySelector<HTMLInputElement>('input[placeholder="' + zh['field.baseURL.placeholder'] + '"]')!
    const secretInput = container.querySelector<HTMLInputElement>('input[type="password"]')!
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      summary.click()
      setValue.call(input, 'http://localhost:19000')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      setValue.call(secretInput, 'fixture-only-unsaved-key')
      secretInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => summary.click())
    expect(card.open).toBe(false)
    await act(async () => summary.click())
    expect(card.open).toBe(true)
    expect(container.contains(input)).toBe(true)
    expect(input.value).toBe('http://localhost:19000')
    expect(secretInput.value).toBe('fixture-only-unsaved-key')
    expect(call).toHaveBeenCalledTimes(1)
    expect(credentials.describe).toHaveBeenCalledTimes(1)
    expect(credentials.set).not.toHaveBeenCalled()

    const save = [...container.querySelectorAll('button')].find(button => button.textContent === zh['action.save'])!
    await act(async () => save.click())
    expect(call).toHaveBeenLastCalledWith('/dsh-pdf-mineru-api', 'mineru/config.set', expect.objectContaining({
      config: expect.objectContaining({ providers: expect.arrayContaining([expect.objectContaining({ baseURL: 'http://localhost:19000' })]) }),
    }))
    expect(credentials.set).toHaveBeenCalledWith('MINERU_API_KEY', 'fixture-only-unsaved-key')
  })

  it.each([true, false])('uses the card only in the plugin slot (available: %s)', async pluginSlot => {
    const { props } = fixture()
    const register = vi.fn((..._args: unknown[]) => () => {})
    const ctx = {
      effect: (effect: () => unknown) => effect(),
      inject: (_deps: string[], callback: (scope: unknown) => void) => callback(ctx),
      get: () => ({ rpc: props.rpc }),
      locale: { register: () => () => {}, bind: () => props.t },
      remote: { credentials: props.credentials },
      slots: {
        spec: () => pluginSlot ? {} : undefined,
        inject: (_name: string, factory: () => unknown) => factory(),
        register,
      },
    } as unknown as Parameters<typeof apply>[0]
    apply(ctx)
    const [options, component] = register.mock.calls[0] as unknown as [{ name: string }, typeof SettingsPage]
    expect(options.name).toBe(pluginSlot ? 'settings.plugin.item' : 'settings.section')
    expect(component).toBe(pluginSlot ? SettingsCard : SettingsPage)
    await act(async () => root.render(createElement(component, props)))
    expect(container.querySelector('details') !== null).toBe(pluginSlot)
    expect(container.querySelector('h2')?.textContent).toBe(pluginSlot ? undefined : zh['page.title'])
  })
})
