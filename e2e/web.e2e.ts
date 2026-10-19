/**
 * The settings page in a real `dsh web` for the isolated profile, driven in
 * headless Chromium like a user: real owner session, real loopback Host, real
 * Settings revisions, credential store and storage maintenance. Every test
 * restores the effective configuration through the page; since a save always
 * writes a complete override, the profile's user layer file is put back once
 * `dsh web` has stopped.
 *
 * Needs a Chromium or Chrome binary: set DSH_E2E_CHROMIUM, otherwise common
 * system paths are tried and the suite is skipped when none exists.
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { type Browser, type BrowserContext, type Locator, type Page, chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { en, type MineruKey } from '../src/client/locales.js'
import type { MinerUConfig } from '../src/config/model.js'
import { parseConfigWithMigration } from '../src/config/migrate.js'
import localeEn from '../locale/en.json' with { type: 'json' }
import { fakeUpstream, json } from '../tests/support/http-fake.js'
import { type PublishedFixture, publishFixtureResult } from '../tests/support/reader-harness.js'
import { artifacts, dumpConfig, enterIsolatedEnvironment, pluginRow, repo, run } from './support/environment.js'
import { minimalPdf } from './support/pdf.js'
import { type WebServer, freePort, startWeb, webLog } from './support/web.js'

const e2e = inject('e2e')
const executablePath = [process.env.DSH_E2E_CHROMIUM, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']
  .find((path): path is string => path !== undefined && existsSync(path))

const DESKTOP = { width: 1280, height: 900 }
const MOBILE = { width: 390, height: 844 }
/** The plugin's page inside the config section of its own bundle detail. */
const PAGE = '[data-plugin-detail="dsh-pdf-mineru"] [data-plugin-config] [data-plugin-detail="dsh-pdf-mineru"]'

/** The page's own English text, with `{name}` placeholders filled in or matched loosely. */
function text(key: MineruKey, params: Record<string, string | number> = {}): RegExp {
  const escaped = en[key].replace(/[.*+?^$()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped.replace(/\{(\w+)\}/g, (_, name: string) => params[name] === undefined ? '.+' : String(params[name]))}$`)
}

/** The plugin's effective configuration as the composed profile defines it. */
function effectiveConfig(): MinerUConfig {
  return parseConfigWithMigration(pluginRow(e2e).config).config
}

function activeBaseURL(config: MinerUConfig): string | undefined {
  return config.providers.find(provider => provider.id === config.activeProvider)?.baseURL
}

/** Files under `root` (dependencies excepted) whose bytes contain `needle`. */
function filesContaining(root: string, needle: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && !entry.parentPath.split('/').includes('node_modules'))
    .map(entry => join(entry.parentPath, entry.name))
    .filter(path => readFileSync(path).includes(needle))
    .map(path => relative(root, path))
}

describe.skipIf(executablePath === undefined)('settings page in DSH Web', () => {
  let server: WebServer
  let browser: Browser
  let context: BrowserContext
  let page: Page
  let initial: MinerUConfig
  let seeded: PublishedFixture
  let userLayer: { readonly path: string; readonly text: string }
  const consoleErrors: string[] = []
  const rpcCalls: { endpoint: string; status: number; ok?: boolean; code?: string }[] = []

  /** A tab of the GUI, recording browser errors and the plugin's RPC traffic. */
  async function openTab(url: string): Promise<Page> {
    const tab = await context.newPage()
    tab.setDefaultTimeout(30_000)
    tab.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    tab.on('pageerror', (error) => { consoleErrors.push(error.message) })
    tab.on('response', (response) => {
      const { pathname } = new URL(response.url())
      if (!pathname.startsWith('/dsh-pdf-mineru-api/')) return
      const call = { endpoint: pathname.slice('/dsh-pdf-mineru-api/'.length), status: response.status() }
      void response.json().then(
        ({ result }: { result?: { ok?: boolean; error?: { code?: string } } }) => {
          rpcCalls.push({ ...call, ok: result?.ok, ...result?.error?.code === undefined ? {} : { code: result.error.code } })
        },
        () => { rpcCalls.push(call) },
      )
    })
    // A fresh home greets the user with dialogs that would cover the page.
    await tab.addLocatorHandler(tab.getByRole('dialog', { name: 'Preview Notice' }), async (dialog) => {
      await dialog.getByRole('button', { name: 'Continue' }).click()
    })
    await tab.addLocatorHandler(tab.getByRole('button', { name: 'Configure later' }), async (button) => { await button.click() })
    await tab.addLocatorHandler(tab.getByRole('dialog', { name: 'Get started' }), async (dialog) => {
      await dialog.getByRole('button', { name: 'Close' }).click()
    })
    await tab.goto(url)
    return tab
  }

  /** Open the plugin's bundle detail from the Plugins panel and wait for the settings page. */
  async function openSettings(tab: Page): Promise<Locator> {
    await tab.getByRole('navigation', { name: 'Global panels' }).getByRole('button', { name: 'Plugins' }).click()
    await tab.locator('[data-plugin-package="dsh-pdf-mineru"]').getByRole('button', { name: `View ${localeEn.meta.title}` }).click()
    const settings = tab.locator(PAGE)
    await settings.locator('#mineru-base-url').waitFor()
    return settings
  }

  /** Screenshot for people only; `full` grows the viewport to fit the scrolled settings page. */
  async function shoot(tab: Page, name: string, full = true): Promise<void> {
    const viewport = tab.viewportSize()!
    const overflow = !full ? 0 : await tab.locator(PAGE).evaluate((element) => {
      for (let node = element.parentElement; node !== null; node = node.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight) {
          node.scrollTop = 0
          return node.scrollHeight - node.clientHeight
        }
      }
      return 0
    })
    if (overflow > 0) await tab.setViewportSize({ width: viewport.width, height: Math.min(viewport.height + overflow, 6000) })
    await tab.screenshot({ path: join(artifacts, `${name}.png`), animations: 'disabled' })
    if (overflow > 0) await tab.setViewportSize(viewport)
  }

  async function save(settings: Locator): Promise<void> {
    await settings.locator('[data-action-bar]').getByRole('button', { name: en['action.save'], exact: true }).click()
    await settings.locator('[data-action-bar=saved]').waitFor()
  }

  async function setBaseURL(settings: Locator, url: string): Promise<void> {
    await settings.locator('#mineru-base-url').fill(url)
  }

  beforeAll(async () => {
    enterIsolatedEnvironment(e2e.env)
    initial = effectiveConfig()
    const layerPath = join(e2e.env.DSH_HOME, 'profiles', 'web', 'cordis.patch.yml')
    userLayer = { path: layerPath, text: readFileSync(layerPath, 'utf8') }
    // One valid published result in the plugin's storage root before the host starts.
    const source = join(run, 'seed', 'cached.pdf')
    mkdirSync(join(run, 'seed'), { recursive: true })
    writeFileSync(source, minimalPdf('Cached'))
    seeded = await publishFixtureResult({ sourcePath: source, config: initial, markdown: '# Cached\n' })
    server = await startWeb(e2e)
    browser = await chromium.launch({ executablePath: executablePath!, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
    context = await browser.newContext({ viewport: DESKTOP, locale: 'en-US' })
    page = await openTab(server.url)
  })

  afterAll(async () => {
    await browser?.close()
    await server?.stop()
    if (userLayer !== undefined) writeFileSync(userLayer.path, userLayer.text)
  })

  it('shows the localized title and icon, with settings in the bundle detail and not in global Settings', async () => {
    const settings = await openSettings(page)
    await expect.poll(() => settings.count()).toBe(1)
    const detail = page.locator('[data-plugin-detail="dsh-pdf-mineru"]').filter({ has: page.locator('[data-plugin-config]') })
    await detail.getByRole('heading', { name: localeEn.meta.title, exact: true }).waitFor()
    const icon = await detail.locator('img').first().evaluate((image: HTMLImageElement) => ({ src: image.src, width: image.naturalWidth }))
    expect(icon.width).toBeGreaterThan(0)
    expect(Buffer.from(icon.src.replace(/^data:image\/svg\+xml;base64,/, ''), 'base64').toString()).toBe(readFileSync(join(repo, 'assets/icon.svg'), 'utf8'))
    await shoot(page, 'settings-desktop')

    await page.getByRole('button', { name: 'Account menu' }).click()
    await page.getByRole('menuitem', { name: 'Settings' }).click()
    const global = page.getByRole('dialog', { name: 'Settings' })
    await global.getByRole('navigation').waitFor()
    expect(await global.getByText(/MinerU/).count()).toBe(0)
    expect(await global.locator('[data-plugin-detail="dsh-pdf-mineru"]').count()).toBe(0)
    await page.keyboard.press('Escape')
    await global.waitFor({ state: 'hidden' })
  })

  it('loads through the owner-only RPC on a loopback Host and keeps drafts across tabs', async () => {
    const settings = page.locator(PAGE)
    expect(rpcCalls).toContainEqual({ endpoint: 'mineru/config.get', status: 200, ok: true })
    expect(rpcCalls.filter(call => call.ok !== true)).toEqual([])
    expect(await settings.locator('#mineru-base-url').inputValue()).toBe(activeBaseURL(initial))

    await setBaseURL(settings, 'http://127.0.0.1:18002')
    await settings.getByRole('tab', { name: en['tab.storage'] }).click()
    await settings.getByText(initial.storage.storageRoot).waitFor()
    await settings.getByRole('tab', { name: en['tab.connection'] }).click()
    expect(await settings.locator('#mineru-base-url').inputValue()).toBe('http://127.0.0.1:18002')
    await settings.locator('[data-action-bar]').getByRole('button', { name: en['action.discard'] }).click()
    expect(await settings.locator('#mineru-base-url').inputValue()).toBe(activeBaseURL(initial))
    await settings.locator('[data-action-bar]').waitFor({ state: 'detached' })
  })

  it('saves the service URL to the profile, then restores it', async () => {
    const settings = page.locator(PAGE)
    await setBaseURL(settings, 'http://127.0.0.1:18001')
    await settings.locator('[data-action-bar]').getByText(en['bar.unsaved']).waitFor()
    await save(settings)
    expect(activeBaseURL(effectiveConfig())).toBe('http://127.0.0.1:18001')

    await setBaseURL(settings, activeBaseURL(initial)!)
    await save(settings)
    expect(effectiveConfig()).toEqual(initial)
  })

  it('refuses a stale save after another tab saved, and reloads the other tab\'s value', async () => {
    const stale = page.locator(PAGE)
    const other = await openTab(new URL(server.url).origin)
    try {
      const fresh = await openSettings(other)
      await setBaseURL(fresh, 'http://127.0.0.1:18003')
      await save(fresh)

      await setBaseURL(stale, 'http://127.0.0.1:18004')
      await stale.locator('[data-action-bar]').getByRole('button', { name: en['action.save'], exact: true }).click()
      await stale.locator('[data-action-bar=conflict]').getByText(en['bar.conflict']).waitFor()
      await expect.poll(() => rpcCalls).toContainEqual({ endpoint: 'mineru/config.set', status: 200, ok: false, code: 'mineru/conflict' })
      expect(await stale.locator('[data-action-bar]').getByRole('button', { name: en['action.save'], exact: true }).count()).toBe(0)
      expect(activeBaseURL(effectiveConfig())).toBe('http://127.0.0.1:18003')
      await shoot(page, 'settings-conflict', false)

      await stale.locator('[data-action-bar]').getByRole('button', { name: en['action.reload'] }).click()
      await expect.poll(() => stale.locator('#mineru-base-url').inputValue()).toBe('http://127.0.0.1:18003')
      await stale.locator('[data-action-bar]').waitFor({ state: 'detached' })

      await setBaseURL(stale, activeBaseURL(initial)!)
      await save(stale)
      expect(effectiveConfig()).toEqual(initial)
    } finally {
      await other.close()
    }
  })

  it('keeps the API key in the credential store only, and removes it', async () => {
    const settings = page.locator(PAGE)
    const service = settings.locator('[data-section=service]')
    const secret = `mineru-e2e-${randomUUID()}`
    const store = join(e2e.env.DSH_HOME, '.credentials.yaml')
    await service.getByText(en['apiKey.missing'], { exact: true }).waitFor()

    await settings.locator('#mineru-api-key').fill(secret)
    await save(settings)
    await service.getByText(en['apiKey.stored'], { exact: true }).waitFor()
    expect(await settings.locator('#mineru-api-key').inputValue()).toBe('')
    expect(readFileSync(store, 'utf8')).toContain(secret)
    expect(filesContaining(e2e.env.DSH_HOME, secret)).toEqual(['.credentials.yaml'])
    expect(filesContaining(e2e.env.XDG_CONFIG_HOME, secret)).toEqual([])
    expect(dumpConfig(e2e)).not.toContain(secret)
    expect(readFileSync(webLog, 'utf8')).not.toContain(secret)

    await service.getByRole('button', { name: en['action.removeKey'] }).click()
    await service.getByText(en['apiKey.missing'], { exact: true }).waitFor()
    expect(readFileSync(store, 'utf8')).not.toContain(secret)
    expect(effectiveConfig()).toEqual(initial)
  })

  it('tests the unsaved server URL through the host', async () => {
    const settings = page.locator(PAGE)
    const service = settings.locator('[data-section=service]')
    const mineru = await fakeUpstream({ 'GET /health': json(200, { status: 'healthy', version: '3.1.0-e2e' }) })

    await setBaseURL(settings, mineru.url)
    await service.getByRole('button', { name: en['action.test'] }).click()
    await service.getByText(en['probe.ok'], { exact: true }).waitFor()
    await service.getByText(text('probe.version', { version: '3.1.0-e2e' })).waitFor()
    expect(mineru.requestsFor('GET /health').length).toBeGreaterThan(0)

    await setBaseURL(settings, `http://127.0.0.1:${await freePort()}`)
    await service.getByRole('button', { name: en['action.test'] }).click()
    await service.getByText(en['probe.unavailable'], { exact: true }).waitFor({ timeout: 60_000 })

    await settings.locator('[data-action-bar]').getByRole('button', { name: en['action.discard'] }).click()
    expect(effectiveConfig()).toEqual(initial)
  })

  it('shows storage usage and clears the cache after preview and confirmation', async () => {
    const settings = page.locator(PAGE)
    const maintenance = settings.locator('[data-section=maintenance]')
    await settings.getByRole('tab', { name: en['tab.storage'] }).click()
    const results = maintenance.getByText(en['usage.results'], { exact: true }).locator('..')
    await results.getByText(text('usage.items', { count: 1 })).waitFor()
    await shoot(page, 'settings-storage')

    await maintenance.getByRole('button', { name: en['action.clear'] }).click()
    const dialog = page.getByRole('dialog', { name: en['dialog.clear.title'] })
    await dialog.getByText(text('dialog.clear.ready', { count: 1 })).waitFor()
    expect(existsSync(seeded.manifestPath)).toBe(true)
    await shoot(page, 'settings-clear-dialog', false)
    await dialog.getByRole('button', { name: en['action.delete'] }).click()
    await maintenance.getByText(text('clear.done', { count: 1 })).waitFor()
    await results.getByText(text('usage.items', { count: 0 })).waitFor()
    expect(existsSync(seeded.manifestPath)).toBe(false)
  })

  it('fits a 390 px screen and follows the dark theme', async () => {
    const settings = page.locator(PAGE)
    await page.setViewportSize(MOBILE)
    await shoot(page, 'settings-storage-mobile')
    await settings.getByRole('tab', { name: en['tab.connection'] }).click()
    await shoot(page, 'settings-mobile')
    const box = await settings.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(MOBILE.width)

    await page.emulateMedia({ colorScheme: 'dark' })
    await page.locator('body[data-ds-dark-theme]').waitFor({ state: 'attached' })
    await shoot(page, 'settings-dark-mobile')
    await page.setViewportSize(DESKTOP)
    await shoot(page, 'settings-dark')
    await page.emulateMedia({ colorScheme: 'light' })
  })

  it('logs no browser errors and no refused RPC', () => {
    writeFileSync(join(artifacts, 'console-errors.json'), JSON.stringify(consoleErrors, null, 2))
    expect(consoleErrors).toEqual([])
    // The stale save above is the only call the plugin refused; the host never answered 403.
    expect(rpcCalls.filter(call => call.status !== 200 || call.ok !== true)).toEqual([
      { endpoint: 'mineru/config.set', status: 200, ok: false, code: 'mineru/conflict' },
    ])
  })
})
