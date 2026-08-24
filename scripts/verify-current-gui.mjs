import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
const config = {
  schemaVersion: 1,
  activeProvider: 'mp_self_hosted',
  providers: [{
    id: 'mp_self_hosted', type: 'self-hosted-v2', baseURL: 'http://localhost:18000',
    apiKeyEnv: 'MINERU_API_KEY', modelMap: { pipeline: 'pipeline', vlm: 'vlm-engine' }, allowInsecureHttp: true,
  }],
  defaults: { model: 'pipeline', ocr: false, parseMethod: 'auto', language: 'ch', formula: true, table: true, artifacts: ['markdown'] },
  storage: { storageRoot: '/tmp/mineru-ui-verification', cacheEnabled: true, retainSources: false, stagingTtlMs: 86400000 },
  polling: { pollIntervalMs: 2000, pollTimeoutMs: 600000, requestTimeoutMs: 60000, operationTimeoutMs: 3600000 },
  output: { maxInlineChars: 200000 },
  limits: {
    maxFilesPerRequest: 1, maxFileBytes: 209715200, maxApiResponseBytes: 8388608,
    maxZipDownloadBytes: 536870912, maxZipEntries: 10000, maxZipEntryBytes: 268435456,
    maxZipTotalBytes: 2147483648, maxZipCompressionRatio: 200,
  },
}

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
const rpcCalls = []
let bundleIntercepts = 0
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
page.on('pageerror', error => errors.push(error.message))
await page.route('**/plugins/dsh-pdf-mineru/client.js?*', route => {
  bundleIntercepts++
  return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: bundle })
})
await page.route('**/dsh-pdf-mineru-api/**', async route => {
  const url = new URL(route.request().url())
  const endpoint = url.pathname.slice('/dsh-pdf-mineru-api/'.length)
  const payloadText = route.request().postData()
  const envelope = payloadText ? JSON.parse(payloadText) : {}
  const payload = envelope.payload ?? {}
  rpcCalls.push({ endpoint, payload })
  let result
  if (endpoint === 'mineru/config.get') result = { ok: true, value: { config } }
  else if (endpoint === 'mineru/config.set') result = { ok: true, value: { config: payload.config } }
  else if (endpoint === 'mineru/probe') result = {
    ok: true, value: { available: true, provider: payload.provider.type, authentication: 'valid', protocol_version: payload.provider.type === 'official-v4' ? 'v4' : 'v2' },
  }
  else result = { ok: false, error: { code: 'not-found', message: endpoint } }
  await route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ type: 'server-response', rpcId: envelope.rpcId, result }),
  })
})

await page.goto(process.env.DSH_WEB_URL ?? 'http://127.0.0.1:3080', { waitUntil: 'domcontentloaded', timeout: 30_000 })
await page.waitForTimeout(1000)
await page.getByRole('button', { name: 'Settings', exact: true }).click()
await page.waitForTimeout(300)
await page.getByRole('button', { name: 'MinerU', exact: true }).click()
await page.waitForTimeout(1500)
if (await page.getByText('Provider Settings', { exact: true }).count() === 0) {
  console.error(JSON.stringify({ bundleIntercepts, rpcCalls, errors, body: (await page.locator('body').innerText()).slice(0, 8000) }, null, 2))
}
await page.getByText('Provider Settings', { exact: true }).waitFor({ timeout: 10_000 })
const providerType = page.getByLabel('Provider Type')
if (await providerType.inputValue() !== 'self-hosted-v2') throw new Error('initial provider type mismatch')
if (await page.getByText('Pipeline Backend Map', { exact: true }).count() !== 1) throw new Error('self-hosted fields are missing')
await providerType.selectOption('official-v4')
if (await page.getByText('Supported Cloud Models', { exact: true }).count() !== 1) throw new Error('official fields are missing')
if (await page.getByText('Pipeline Backend Map', { exact: true }).count() !== 0) throw new Error('self-hosted fields leaked into official mode')
if (await page.getByLabel('Default Parse Method').locator('option[value=txt]').count() !== 0) throw new Error('official mode exposes unsupported txt method')
await page.getByRole('button', { name: 'Test Active Provider', exact: true }).click()
await page.getByText(/Connection Healthy/).waitFor({ timeout: 5000 })
await providerType.selectOption('self-hosted-v2')
await page.getByRole('button', { name: 'Save Configuration', exact: true }).click()
await page.getByRole('button', { name: 'Saved', exact: true }).waitFor({ timeout: 5000 })
await page.screenshot({ path: '/tmp/mineru-current-settings-desktop.png', fullPage: true })

const desktopMetrics = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
}))
await page.setViewportSize({ width: 390, height: 844 })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)
await page.getByRole('button', { name: 'Open directory', exact: true }).click()
await page.getByRole('button', { name: 'Settings', exact: true }).click()
await page.waitForTimeout(300)
await page.getByRole('button', { name: 'MinerU', exact: true }).click()
await page.getByText('Provider Settings', { exact: true }).waitFor({ timeout: 5000 })
await page.screenshot({ path: '/tmp/mineru-current-settings-mobile.png', fullPage: true })
const providerHeadingBox = await page.getByText('Provider Settings', { exact: true }).boundingBox()
const mineruSection = page.getByRole('heading', { name: 'MinerU Configuration', exact: true }).locator('xpath=ancestor::section[1]')
const sectionBox = await mineruSection.boundingBox()
const visibleControlBoxes = await mineruSection.locator('input:visible, select:visible, button:visible').evaluateAll(elements => elements.map(element => {
  const box = element.getBoundingClientRect()
  return { tag: element.tagName, text: (element.textContent ?? '').trim().slice(0, 80), x: box.x, right: box.right, width: box.width }
}))
const mobileMetrics = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
  bodyText: document.body.innerText.slice(0, 5000),
}))
if (mobileMetrics.scrollWidth > mobileMetrics.clientWidth) throw new Error('mobile settings page has horizontal overflow')
if (sectionBox === null || sectionBox.x < 0 || sectionBox.x + sectionBox.width > 390) {
  throw new Error(`mobile MinerU section is outside the viewport: ${JSON.stringify(sectionBox)}`)
}
if (providerHeadingBox === null || providerHeadingBox.x < 0 || providerHeadingBox.x + providerHeadingBox.width > 390) {
  throw new Error(`mobile Provider Settings heading is outside the viewport: ${JSON.stringify(providerHeadingBox)}`)
}
if (visibleControlBoxes.some(box => box.x < -1 || box.right > 391)) throw new Error('a visible mobile control crosses the viewport')
if (errors.length > 0) throw new Error(`browser errors: ${errors.join('; ')}`)
const probe = rpcCalls.find(call => call.endpoint === 'mineru/probe')
if (probe?.payload?.provider?.type !== 'official-v4') throw new Error('draft probe did not carry official provider')
const save = rpcCalls.find(call => call.endpoint === 'mineru/config.set')
if (save?.payload?.config?.providers?.[0]?.type !== 'self-hosted-v2') throw new Error('save did not carry current provider config')
console.log(JSON.stringify({
  providerSwitch: true, draftProbe: true, save: true, errors, desktopMetrics, mobileMetrics, sectionBox, providerHeadingBox, visibleControlBoxes,
  rpcEndpoints: rpcCalls.map(call => call.endpoint),
  screenshots: ['/tmp/mineru-current-settings-desktop.png', '/tmp/mineru-current-settings-mobile.png'],
}, null, 2))
await browser.close()
