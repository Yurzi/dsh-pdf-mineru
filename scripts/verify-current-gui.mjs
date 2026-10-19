import { createHash, createHmac } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
const screenshotDir = fileURLToPath(new URL('../.vitest-cache/gui/', import.meta.url))
await mkdir(screenshotDir, { recursive: true })
const requestedWebUrl = new URL(
  process.env.DSH_WEB_AUTH_URL ?? process.env.DSH_WEB_URL ?? 'http://127.0.0.1:3080',
)
const webUrl = new URL(requestedWebUrl)
webUrl.search = ''
webUrl.hash = ''
const clientInject = [
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-plugin-manager',
  '@deepseek-ai/dsh-api-remotes',
]

// Explicit browser-fixture isolation only; never modifies the running host profile.
const excludedPluginIds = new Set((process.env.DSH_GUI_EXCLUDE_PLUGINS ?? '').split(',').map(id => id.trim()).filter(Boolean))
if (excludedPluginIds.has('dsh-pdf-mineru')) throw new Error('Cannot exclude the plugin under verification')

function injectCurrentPlugin(html) {
  const assignment = 'globalThis["__DSH_BOOT__"] = '
  const start = html.indexOf(assignment)
  if (start < 0) throw new Error('DSH shell HTML does not contain __DSH_BOOT__')
  const jsonStart = start + assignment.length
  const jsonEnd = html.indexOf('</script>', jsonStart)
  if (jsonEnd < 0) throw new Error('DSH shell boot payload is unterminated')
  const boot = JSON.parse(html.slice(jsonStart, jsonEnd))
  if (!Array.isArray(boot.entries)) throw new Error('DSH shell boot payload has no entries')
  if (!Array.isArray(boot.batches)) throw new Error('DSH shell boot payload has no batches')

  const pluginId = 'dsh-pdf-mineru'
  const pluginUrl = '/plugins/??dsh-pdf-mineru/client.js&rev=workspace-current'
  const removedIds = new Set([pluginId, ...excludedPluginIds])
  const retainedEntries = boot.entries.filter(entry => !removedIds.has(entry.id))
  const retainedById = new Map(retainedEntries.map(entry => [entry.id, entry]))
  const retainedBatches = []
  for (const batch of boot.batches) {
    if (!Array.isArray(batch.entries)) throw new Error('DSH shell boot batch has no entries')
    if (!batch.entries.some(id => removedIds.has(id))) {
      retainedBatches.push(batch)
      continue
    }
    // A combo containing the installed MinerU bundle must not remain the
    // initial URL for its neighbours: split those rows onto their single-entry
    // URLs so the stale factory can be preloaded but never executed.
    for (const id of batch.entries.filter(entryId => !removedIds.has(entryId))) {
      const entry = retainedById.get(id)
      if (entry === undefined) throw new Error(`DSH shell boot batch names unknown entry ${id}`)
      retainedBatches.push({ phase: batch.phase, url: entry.url, rev: entry.rev, entries: [id] })
    }
  }
  boot.entries = [
    ...retainedEntries,
    { id: pluginId, url: pluginUrl, rev: 'workspace-current', inject: clientInject },
  ]
  boot.batches = [
    ...retainedBatches,
    { phase: 'application', url: pluginUrl, rev: 'workspace-current', entries: [pluginId] },
  ]
  boot.rev = 'workspace-current'
  return html.slice(0, jsonStart) + JSON.stringify(boot) + html.slice(jsonEnd)
}

const config = {
  schemaVersion: 3,
  activeProvider: 'mp_self_hosted',
  providers: [{
    id: 'mp_self_hosted', type: 'self-hosted-legacy-v2', baseURL: 'http://localhost:18000',
    apiKeyEnv: 'MINERU_API_KEY', modelMap: { pipeline: 'pipeline', vlm: 'vlm-engine' }, allowInsecureHttp: true,
  }],
  defaults: { model: 'pipeline', ocr: false, parseMethod: 'auto', language: 'ch', formula: true, table: true },
  storage: { storageRoot: '/tmp/mineru-ui-verification', cacheEnabled: true, retainSources: false, stagingTtlMs: 86400000 },
  polling: { pollIntervalMs: 2000, pollTimeoutMs: 600000, requestTimeoutMs: 60000, operationTimeoutMs: 3600000 },
  retry: { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 10000 },
  output: { maxInlineChars: 200000, maxInlineImages: 6 },
  limits: {
    maxFileBytes: 209715200, maxApiResponseBytes: 8388608,
    maxZipDownloadBytes: 536870912, maxZipEntries: 10000, maxZipEntryBytes: 268435456,
    maxZipTotalBytes: 2147483648, maxZipCompressionRatio: 200,
  },
}

const storageArea = (byteUsage, logicalEntryCount) => ({
  byteUsage, logicalEntryCount, regularFileCount: logicalEntryCount,
  directoryCount: logicalEntryCount, skippedSymlinkCount: 0, unexpectedEntryCount: 0,
  unreadableEntryCount: 0, depthLimitCount: 0, complete: true, truncated: false,
})
const storageStats = {
  generatedAt: Date.now(),
  publishedResults: storageArea(4096, 2),
  staging: { ...storageArea(1024, 1), complete: false, truncated: true }, quarantine: storageArea(512, 2),
}
const integrityScan = {
  generatedAt: Date.now(), readOnly: true, isolateInvalid: false, validCount: 2, corruptCount: 0,
  missingCount: 0, unreadableCount: 0, quarantinedCount: 0,
  scan: { limit: 10000, scanned: 2, truncated: false, diagnosticsLimit: 50, diagnosticsTruncated: false },
  diagnostics: [],
}
const cacheClearReport = dryRun => ({
  generatedAt: Date.now(), dryRun, eligible: true, activeJobCount: 0, activeOperationCount: 0, activeAccessCount: 0,
  ...(dryRun ? { confirmationToken: 'cache-clear-preview-token' } : {}),
  plannedCount: 2, plannedBytes: 4096,
  deletedCount: dryRun ? 0 : 2, deletedBytes: dryRun ? 0 : 4096,
  skippedCount: 0,
  jobScan: { complete: true, sessionJobCount: 3, activeJobCount: 0, referencedCacheKeyCount: 1 },
  scan: { limit: 10000, scanned: 2, truncated: false, diagnosticsLimit: 50, diagnosticsTruncated: false },
  diagnostics: [],
})

const quarantineReport = {
  generatedAt: Date.now(),
  entries: [
    { id: 'entry_corrupt_1', byteUsage: 256, regularFileCount: 1, directoryCount: 1, modifiedAt: Date.now() },
    { id: 'entry_corrupt_2', byteUsage: 256, regularFileCount: 1, directoryCount: 1, modifiedAt: Date.now() },
  ],
  totalCount: 2, totalBytes: 512, truncated: false,
  skippedSymlinkCount: 0, unexpectedEntryCount: 0, unreadableEntryCount: 0,
}

function encodeBase64Url(value) {
  return Buffer.from(value).toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
}

function decodeBase64Url(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  return Buffer.from(value.replaceAll('-', '+').replaceAll('_', '/') + padding, 'base64')
}

async function tryGetAuthCookie(authority) {
  try {
    const dshHome = process.env.DSH_HOME ?? join(process.env.HOME ?? '', '.dsh')
    const credsPath = join(dshHome, '.credentials.yaml')
    const credsRaw = await readFile(credsPath, 'utf8')
    const secretMatch = credsRaw.match(/secret:\s*([A-Za-z0-9_-]+)/)
    if (!secretMatch) return null
    const secret = decodeBase64Url(secretMatch[1])
    const cookieName = 'dsh-auth-' + encodeBase64Url(createHash('sha256').update(authority).digest())
    const issuedAt = Date.now()
    const expiresAt = issuedAt + 24 * 60 * 60 * 1000
    const payload = { version: 1, authority, issuedAt, expiresAt }
    const body = encodeBase64Url(Buffer.from(JSON.stringify(payload), 'utf8'))
    const sig = createHmac('sha256', secret).update(body).digest()
    const cookieVal = `v1.${body}.${encodeBase64Url(sig)}`
    return { name: cookieName, value: cookieVal }
  } catch {
    return null
  }
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-features=LocalNetworkAccessChecks'],
})
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const authCookie = await tryGetAuthCookie(webUrl.host)
if (authCookie) {
  await context.addCookies([{
    name: authCookie.name,
    value: authCookie.value,
    domain: webUrl.hostname,
    path: '/',
    httpOnly: true,
    sameSite: 'Strict',
  }])
}
const page = await context.newPage()
const authResponse = await page.goto(requestedWebUrl.toString(), {
  waitUntil: 'domcontentloaded', timeout: 30_000,
})
if (authResponse?.status() === 401) {
  await browser.close()
  throw new Error(
    'DSH Web authentication is required; set DSH_WEB_AUTH_URL to the tokenized URL printed by dsh web',
  )
}
await page.goto('about:blank')
const errors = []
const failedRequests = []
page.on('requestfailed', request => {
  const url = new URL(request.url())
  failedRequests.push({ path: url.origin + url.pathname, error: request.failure()?.errorText })
})
const unrelatedPluginErrors = new Set()
function isKnownExternalError(text) {
  if (text.includes('dsh-web-search-enhanced/client.js')
    && text.includes('cannot get property "remote.searchConnections" without inject')) {
    unrelatedPluginErrors.add('dsh-web-search-enhanced: remote.searchConnections injection failure')
    return true
  }
  return false
}
const rpcCalls = []
const pluginManagerCalls = []
const fixturePluginEntry = {
  entryId: 'gui-fixture:mineru', moduleName: 'dsh-pdf-mineru', enabled: true, fiberPhase: 'active',
}
const fixtureBundle = {
  name: 'dsh-pdf-mineru', enabled: true, installed: true, optional: false, removable: true,
  description: 'Browser-only MinerU configuration verification fixture',
  rows: [{ rowId: 'mineru', moduleName: 'dsh-pdf-mineru', entryId: fixturePluginEntry.entryId }],
  overrides: [],
}
let configGetCalls = 0
let failConfigLoad = true
let serverConfig = config
let serverRevision = 1
let conflictNextSave = false
const credentialCalls = []
let credentialConfigured = true
let bundleIntercepts = 0
const bundleRequests = []
page.on('console', message => {
  if (message.type() === 'error') {
    const text = message.text()
    if (!text.includes('sidebar/ws') && !text.includes('dsh-better-sidebar') && !isKnownExternalError(text)) {
      errors.push(text)
    }
  }
})
page.on('pageerror', error => {
  if (!error.message.includes('remote.session') && !isKnownExternalError(error.stack ?? error.message)) {
    errors.push(error.message)
  }
})

await page.route(
  url => url.origin === webUrl.origin && url.pathname === webUrl.pathname && url.search === '',
  async route => {
    const response = await route.fetch()
    const html = injectCurrentPlugin(await response.text())
    await route.fulfill({ response, body: html, contentType: 'text/html; charset=utf-8' })
  },
)
await page.route(
  url => url.origin === webUrl.origin
    && url.pathname === '/plugins/'
    && url.search.startsWith('??dsh-pdf-mineru/client.js&rev='),
  route => {
    bundleIntercepts++
    bundleRequests.push({ url: route.request().url(), resourceType: route.request().resourceType() })
    return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: bundle })
  },
)
await page.route(
  url => url.origin === webUrl.origin && url.pathname === '/plugins/events',
  route => route.fulfill({ status: 204 }),
)
await page.route(
  url => url.origin === webUrl.origin
    && (url.pathname.startsWith('/api/pluginManager/') || url.pathname.startsWith('/api/pluginInventory/')),
  async route => {
    const endpoint = new URL(route.request().url()).pathname.slice('/api/'.length)
    const payloadText = route.request().postData()
    const envelope = payloadText ? JSON.parse(payloadText) : {}
    pluginManagerCalls.push(endpoint)
    let result
    if (endpoint === 'pluginInventory/list') {
      result = { ok: true, value: { managementAvailable: true, entries: [fixturePluginEntry], agentPresets: [] } }
    } else if (endpoint === 'pluginManager/listBundles') {
      result = { ok: true, value: [fixtureBundle] }
    } else if (endpoint === 'pluginManager/listPlugins') {
      result = { ok: true, value: [{ ...fixturePluginEntry, patchId: 'gui-fixture' }] }
    } else {
      errors.push('Unexpected plugin manager RPC blocked by browser fixture: ' + endpoint)
      result = { ok: false, error: { code: 'gateway/not-found', message: endpoint } }
    }
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ type: 'server-response', rpcId: envelope.rpcId, result }),
    })
  },
)
await page.route(
  url => url.origin === webUrl.origin && url.pathname.startsWith('/api/credentials/'),
  async route => {
    const url = new URL(route.request().url())
    const endpoint = url.pathname.slice('/api/'.length)
    const payloadText = route.request().postData()
    const envelope = payloadText ? JSON.parse(payloadText) : {}
    const rawArgs = envelope.payload?.args
    const positionalArgs = Array.isArray(rawArgs) ? rawArgs : []
    const namedArgs = typeof rawArgs === 'object' && rawArgs !== null && !Array.isArray(rawArgs) ? rawArgs : {}
    let result
    if (endpoint === 'credentials/describe') {
      const requestedRefs = positionalArgs[0] ?? namedArgs.refs
      const refs = Array.isArray(requestedRefs) ? requestedRefs.filter(ref => typeof ref === 'string') : []
      credentialCalls.push({ method: 'describe', refs })
      result = {
        ok: true,
        value: Object.fromEntries(refs.map(ref => [ref, { configured: credentialConfigured, source: 'file', writable: true }])),
      }
    } else if (endpoint === 'credentials/set') {
      const rawRef = positionalArgs[0] ?? namedArgs.ref
      const value = positionalArgs[1] ?? namedArgs.value
      const ref = typeof rawRef === 'string' ? rawRef : '<invalid>'
      if (typeof value !== 'string' || value.length === 0) throw new Error('credential set mock received no secret')
      credentialConfigured = true
      credentialCalls.push({ method: 'set', ref })
      result = { ok: true }
    } else if (endpoint === 'credentials/unset') {
      const rawRef = positionalArgs[0] ?? namedArgs.ref
      const ref = typeof rawRef === 'string' ? rawRef : '<invalid>'
      credentialConfigured = false
      credentialCalls.push({ method: 'unset', ref })
      result = { ok: true }
    } else {
      result = { ok: false, error: { code: 'gateway/not-found', message: endpoint } }
    }
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ type: 'server-response', rpcId: envelope.rpcId, result }),
    })
  },
)
await page.route('**/dsh-pdf-mineru-api/**', async route => {
  const url = new URL(route.request().url())
  const endpoint = url.pathname.slice('/dsh-pdf-mineru-api/'.length)
  const payloadText = route.request().postData()
  const envelope = payloadText ? JSON.parse(payloadText) : {}
  const payload = envelope.payload ?? {}
  rpcCalls.push({ endpoint, payload })
  let result
  if (endpoint === 'mineru/config.get') {
    configGetCalls++
    result = failConfigLoad
      ? { ok: false, error: { code: 'mineru/unavailable', message: 'Fixture configuration load failure', details: {} } }
      : { ok: true, value: { config: serverConfig, revision: serverRevision } }
  }
  else if (endpoint === 'mineru/config.set') {
    if (conflictNextSave || payload.expected_revision !== serverRevision) {
      conflictNextSave = false
      // Simulates another window saving first: the stored revision moves on.
      serverRevision++
      result = { ok: false, error: { code: 'mineru/conflict', message: 'settings revision changed', details: {} } }
    } else {
      serverConfig = payload.config
      serverRevision++
      result = { ok: true, value: { config: serverConfig, revision: serverRevision } }
    }
  }
  else if (endpoint === 'mineru/probe') result = {
    ok: true, value: { available: true, provider: payload.provider.type, authentication: 'valid',
      protocol_version: payload.provider.type === 'official-v4' ? 'v4' : payload.provider.type === 'self-hosted-v1' ? 'v1' : 'v2',
      ...(payload.provider.type === 'self-hosted-v1' ? { available_tiers: ['flash','basic','standard','advanced'], output_formats: ['markdown','middle_json','structured_content','zip'], source_types: ['file_id','url','inline'] } : {}),
    },
  }
  else if (endpoint === 'mineru/storage.stats') result = { ok: true, value: storageStats }
  else if (endpoint === 'mineru/storage.integrity.scan') result = { ok: true, value: integrityScan }
  else if (endpoint === 'mineru/storage.cache.clear') result = { ok: true, value: cacheClearReport(payload.dry_run !== false) }
  else if (endpoint === 'mineru/storage.quarantine.list') result = { ok: true, value: quarantineReport }
  else if (endpoint === 'mineru/storage.quarantine.cleanup') result = {
    ok: true,
    value: {
      generatedAt: Date.now(), dryRun: payload.dry_run !== false, requestedCount: payload.entry_ids.length,
      plannedCount: payload.entry_ids.length, plannedBytes: 256,
      deletedCount: payload.dry_run === false ? payload.entry_ids.length : 0,
      deletedBytes: payload.dry_run === false ? 256 : 0,
      missingCount: 0, skippedCount: 0, entries: quarantineReport.entries.filter(entry => payload.entry_ids.includes(entry.id)),
    },
  }
  else result = { ok: false, error: { code: 'mineru/not-found', message: endpoint } }
  await route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ type: 'server-response', rpcId: envelope.rpcId, result }),
  })
})

await page.goto(webUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 })
await page.waitForTimeout(3000)
await page.getByRole('button', { name: 'Settings', exact: true }).click().catch(async error => {
  console.error(JSON.stringify({ errors, failedRequests, unrelatedPluginErrors: [...unrelatedPluginErrors], bundleIntercepts, buttons: await page.getByRole('button').allTextContents() }, null, 2))
  await browser.close()
  throw error
})
const globalSettings = page.getByRole('dialog', { name: 'Settings', exact: true })
await globalSettings.waitFor({ timeout: 10000 }).catch(async error => {
  console.error(JSON.stringify({ errors, failedRequests, unrelatedPluginErrors: [...unrelatedPluginErrors], body: (await page.locator('body').innerText()).slice(0, 10000) }, null, 2))
  await page.screenshot({ path: join(screenshotDir, 'mineru-shell-failure.png'), fullPage: true })
  await browser.close()
  throw error
})
if (await globalSettings.getByRole('navigation').getByRole('button', { name: /MinerU/i }).count() !== 0) {
  throw new Error('MinerU still appears in global settings navigation')
}
if (await globalSettings.getByRole('heading', { name: 'MinerU Configuration', exact: true }).count() !== 0) {
  throw new Error('MinerU configuration still renders in global settings')
}
await page.keyboard.press('Escape')
await globalSettings.waitFor({ state: 'hidden', timeout: 5000 })
await page.getByRole('button', { name: 'Plugins', exact: true }).click()
const bundleCard = page.locator('[data-plugin-package="dsh-pdf-mineru"]')
await bundleCard.getByRole('button', { name: /^View / }).click().catch(async error => {
  console.error(JSON.stringify({ errors, failedRequests, pluginManagerCalls, unrelatedPluginErrors: [...unrelatedPluginErrors], bundleIntercepts, buttons: await page.getByRole('button').allTextContents() }, null, 2))
  await browser.close()
  throw error
})
const bundleDetail = page.locator('[data-plugin-detail="dsh-pdf-mineru"]').first()
await bundleDetail.waitFor({ timeout: 5000 })
const bundleConfig = bundleDetail.locator('section[data-plugin-config]')
await bundleConfig.getByRole('alert').filter({ hasText: 'Fixture configuration load failure' }).waitFor({ timeout: 5000 }).catch(async error => {
  console.error(JSON.stringify({ configGetCalls, rpcCalls, errors, body: (await page.locator('body').innerText()).slice(-8000) }, null, 2))
  throw error
})
failConfigLoad = false
await bundleConfig.getByRole('button', { name: 'Try again', exact: true }).click()
const mineru = bundleConfig.locator('[data-plugin-detail="dsh-pdf-mineru"]')
const serviceSection = mineru.locator('[data-section=service]')
await serviceSection.waitFor({ timeout: 10_000 }).catch(async error => {
  console.error(JSON.stringify({ bundleIntercepts, rpcCalls, credentialCalls, errors, body: (await page.locator('body').innerText()).slice(0, 8000) }, null, 2))
  throw error
})
if (await mineru.count() !== 1) throw new Error('custom MinerU page was not mounted once in its bundle configuration slot')
if (bundleIntercepts !== 1) throw new Error(`workspace bundle was fetched ${bundleIntercepts} times during desktop boot: ${JSON.stringify(bundleRequests)}`)

const actionBar = mineru.locator('[data-action-bar]')
const savedNotice = mineru.locator('[data-action-bar=saved]')
const saveButton = actionBar.getByRole('button', { name: 'Save', exact: true })
if (await actionBar.count() !== 0) throw new Error('action bar is shown for a clean draft')

// Screenshots capture the whole settings page: grow the viewport by the scroll overflow.
async function shot(name, { full = true } = {}) {
  await page.waitForTimeout(250)
  const viewport = page.viewportSize()
  if (!full) {
    await page.screenshot({ path: join(screenshotDir, name), animations: 'disabled' })
    return
  }
  const overflow = await mineru.evaluate(element => {
    for (let node = element.parentElement; node !== null; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
        node.scrollTop = 0
        return node.scrollHeight - node.clientHeight
      }
    }
    return 0
  })
  await page.setViewportSize({ width: viewport.width, height: Math.min(viewport.height + overflow + 24, 6000) })
  await page.waitForTimeout(250)
  await page.screenshot({ path: join(screenshotDir, name), animations: 'disabled' })
  await page.setViewportSize(viewport)
  await page.waitForTimeout(150)
}

const credentialInput = mineru.locator('#mineru-api-key')
await credentialInput.waitFor({ timeout: 5000 })
if (await credentialInput.getAttribute('type') !== 'password') throw new Error('API key control is not a password input')
if (await credentialInput.inputValue() !== '') throw new Error('credential value was restored into the browser')
if (await page.getByLabel('API key', { exact: true }).count() !== 1) throw new Error('API key input has no accessible label')
await mineru.getByRole('button', { name: 'Remove key', exact: true }).waitFor({ timeout: 5000 })

const providerGroup = mineru.getByRole('radiogroup', { name: 'Provider', exact: true })
const legacyProvider = providerGroup.locator('input[value=mp_self_hosted]')
const officialProvider = providerGroup.locator('input[value=mp_official]')
const v1Provider = providerGroup.locator('input[value=mp_self_hosted_v1]')
if (!await legacyProvider.isChecked()) throw new Error('initial active provider mismatch')
if (await providerGroup.getByRole('radio').count() !== 3) throw new Error('legacy single-provider config was not completed with all three profiles')
await shot('mineru-connection-desktop.png')

const optionsToggle = serviceSection.getByRole('button', { name: 'Connection options', exact: true })
if (await optionsToggle.getAttribute('aria-expanded') !== 'false') throw new Error('connection options are not initially collapsed')
await optionsToggle.click()
if (await mineru.locator('#mineru-backend-vlm').inputValue() !== 'vlm-engine') throw new Error('legacy backend fields are missing')

const baseUrlInput = mineru.locator('#mineru-base-url')
const parseMethod = mineru.locator('#mineru-parse-method')
const txtNotice = mineru.locator('#mineru-parse-method-note')
await baseUrlInput.fill('http://gpu-server:18000')
await parseMethod.selectOption('txt')
if (await mineru.locator('#mineru-tier').count() !== 0) throw new Error('V1 tier leaked into legacy profile')
await actionBar.getByText('Unsaved changes', { exact: true }).waitFor({ timeout: 5000 })
await shot('mineru-dirty-desktop.png', { full: false })

// V1 profile: protocol-specific parsing controls and an independent draft.
await v1Provider.check()
if (await parseMethod.count() !== 0 || await mineru.locator('#mineru-model').count() !== 0 || await mineru.locator('#mineru-backend-vlm').count() !== 0 || await mineru.getByText('Formulas', { exact: true }).count() !== 0) throw new Error('legacy controls leaked into V1')
await mineru.locator('#mineru-tier').selectOption('advanced')
await mineru.locator('#mineru-ocr-mode').selectOption('txt')
await baseUrlInput.fill('http://v1-gpu:8000')
await mineru.locator('#mineru-version').fill('4.0.10-review')
await serviceSection.getByRole('button', { name: 'Test connection', exact: true }).click()
await serviceSection.getByText('Tiers: flash, basic, standard, advanced', { exact: true }).waitFor()

// Back to legacy: stale probe disappears, shared defaults and base URL are intact, no cloud notice.
await legacyProvider.check()
if (await serviceSection.getByText('Connected', { exact: true }).count() !== 0) throw new Error('stale V1 probe result remained after switching')
if (await parseMethod.inputValue() !== 'txt') throw new Error('V1 profile changed shared legacy defaults')
if (await baseUrlInput.inputValue() !== 'http://gpu-server:18000') throw new Error('V1 switch discarded legacy draft')
if (await txtNotice.count() !== 0) throw new Error('provider notice shown outside its provider')

await v1Provider.check()
if (await mineru.locator('#mineru-tier').inputValue() !== 'advanced' || await mineru.locator('#mineru-ocr-mode').inputValue() !== 'txt' || await baseUrlInput.inputValue() !== 'http://v1-gpu:8000') throw new Error('V1 draft was reset by profile switching')
await shot('mineru-v1-desktop.png')

// Official cloud: txt normalizes to auto with an inline note scoped to this provider.
await officialProvider.check()
if (await parseMethod.inputValue() !== 'auto') throw new Error('official provider did not normalize txt to auto')
await txtNotice.getByText("MinerU Cloud can't use the text layer, so this switched to Auto.", { exact: true }).waitFor({ timeout: 5000 })
if (await mineru.getByText('Enabled models', { exact: true }).count() !== 1) throw new Error('official fields are missing')
if (await mineru.locator('#mineru-backend-vlm').count() !== 0) throw new Error('self-hosted fields leaked into official profile')
if (await baseUrlInput.inputValue() !== 'https://mineru.net/api/v4') throw new Error('official profile did not retain its independent base URL')
if (await parseMethod.locator('option[value=txt]').count() !== 0) throw new Error('official mode exposes unsupported txt method')
await serviceSection.getByRole('button', { name: 'Test connection', exact: true }).click()
await serviceSection.getByText('Connected', { exact: true }).waitFor({ timeout: 5000 })
await shot('mineru-official-desktop.png')

// Keyboard: arrow keys walk the native radio group (official is first, so Left wraps to legacy).
await officialProvider.focus()
await page.keyboard.press('ArrowLeft')
if (!await legacyProvider.isChecked()) throw new Error('provider radio arrow navigation did not activate the legacy profile')
if (await baseUrlInput.inputValue() !== 'http://gpu-server:18000') throw new Error('legacy profile was reset after switching providers')
if (await txtNotice.count() !== 0) throw new Error('cloud txt notice survived switching away from the cloud provider')
await optionsToggle.click()

// Advanced disclosure: unit fields, inline validation, restore defaults inside the section.
const advancedToggle = mineru.locator('[data-section=advanced]').getByRole('button', { name: 'Advanced', exact: true })
if (await advancedToggle.getAttribute('aria-expanded') !== 'false') throw new Error('advanced is not initially collapsed')
await advancedToggle.click()
if (await advancedToggle.getAttribute('aria-expanded') !== 'true') throw new Error('advanced did not expand')
const attemptsInput = page.getByLabel('Attempts per request', { exact: true })
await attemptsInput.fill('0')
await mineru.getByText('Enter a value from 1 to 10.', { exact: true }).waitFor({ timeout: 5000 })
if (await attemptsInput.getAttribute('aria-invalid') !== 'true') throw new Error('invalid number is not marked aria-invalid')
await attemptsInput.fill('4')
if (await mineru.getByText('Enter a value from 1 to 10.', { exact: true }).count() !== 0) throw new Error('validation error stayed after a valid value')
const inlineImagesInput = page.getByLabel('Images per read', { exact: true })
if (await inlineImagesInput.inputValue() !== '6') throw new Error('initial inline image budget mismatch')
await inlineImagesInput.fill('9')
if (await page.getByLabel('Status check interval', { exact: true }).inputValue() !== '2') throw new Error('poll interval is not shown in seconds')
if (await mineru.locator('[data-section=advanced]').getByRole('button', { name: 'Restore defaults', exact: true }).isDisabled()) throw new Error('restore defaults is disabled for edited values')

// Credential and Save: explicit only, key cleared after storing, bar disappears once clean.
await credentialInput.fill('gui-verifier-secret')
if (rpcCalls.some(call => call.endpoint === 'mineru/config.set') || credentialCalls.some(call => call.method !== 'describe')) {
  throw new Error('bundle configuration auto-saved an unsubmitted draft')
}
await shot('mineru-dirty-advanced-desktop.png', { full: false })
await saveButton.click()
await savedNotice.waitFor({ timeout: 5000 })
if (await saveButton.count() !== 0) throw new Error('save control remained after saving a clean draft')
if (await credentialInput.inputValue() !== '') throw new Error('credential input retained the submitted secret')
await savedNotice.waitFor({ state: 'detached', timeout: 6000 })
if (await actionBar.count() !== 0) throw new Error('action bar stayed after the saved notice')
await serviceSection.getByRole('button', { name: 'Remove key', exact: true }).click()
await serviceSection.getByText('Not set', { exact: true }).waitFor({ timeout: 5000 })

// Revision conflict: the stale draft cannot be saved; Reload restores the stored settings.
conflictNextSave = true
await baseUrlInput.fill('http://stale-edit:18000')
await saveButton.click()
await actionBar.getByText('Settings were changed elsewhere. Reload to continue.', { exact: true }).waitFor({ timeout: 5000 })
if (await saveButton.count() !== 0) throw new Error('conflicted draft can still be saved')
await shot('mineru-conflict-desktop.png', { full: false })
await actionBar.getByRole('button', { name: 'Reload', exact: true }).click()
await page.waitForFunction(
  () => [...document.querySelectorAll('input')].some(input => input.value === 'http://gpu-server:18000'),
  undefined, { timeout: 5000 },
).catch(() => { throw new Error('reload after conflict kept the stale draft') })
if (await baseUrlInput.inputValue() !== 'http://gpu-server:18000') throw new Error('reload after conflict kept the stale draft')
await actionBar.waitFor({ state: 'detached', timeout: 5000 }).catch(() => { throw new Error('action bar remained after reloading') })

// Storage tab.
await mineru.getByRole('tab', { name: 'Storage', exact: true }).click()
const maintenance = mineru.locator('[data-section=maintenance]')
await maintenance.getByText('The scan stopped early; totals are minimums.', { exact: true }).waitFor({ timeout: 5000 })
await maintenance.getByText('Parsed results', { exact: true }).waitFor({ timeout: 5000 })
await maintenance.getByRole('button', { name: 'Check', exact: true }).click()
await maintenance.getByText('2 OK · 0 damaged · 0 missing · 0 unreadable', { exact: true }).waitFor({ timeout: 5000 })

await maintenance.getByRole('button', { name: 'Clear…', exact: true }).click()
const dialog = page.getByRole('dialog')
await dialog.getByText('Results to delete: 2 (4.00 KiB).', { exact: true }).waitFor({ timeout: 5000 })
if (rpcCalls.some(call => call.endpoint === 'mineru/storage.cache.clear' && call.payload?.dry_run === false)) throw new Error('cache clear deleted before confirmation')
await shot('mineru-clear-dialog-desktop.png', { full: false })
await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
await maintenance.getByText('Deleted 2 results (4.00 KiB).', { exact: true }).waitFor({ timeout: 5000 })

await maintenance.getByRole('button', { name: 'Review', exact: true }).click()
await maintenance.getByLabel('entry_corrupt_1', { exact: true }).check()
await maintenance.getByRole('button', { name: 'Delete selected…', exact: true }).click()
await dialog.getByText('Selected: 1 (256 B). They will be permanently deleted.', { exact: true }).waitFor({ timeout: 5000 })
await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
await maintenance.getByText('Removed from quarantine: 1', { exact: true }).waitFor({ timeout: 5000 })

const limitsToggle = mineru.locator('[data-section=limits]').getByRole('button', { name: 'Safety limits', exact: true })
if (await limitsToggle.getAttribute('aria-expanded') !== 'false') throw new Error('limits is not initially collapsed')
await limitsToggle.click()
if (await mineru.locator('[data-limit]').count() !== 7) throw new Error('security limit values are missing')
if (await mineru.locator('[data-section=limits] input').count() !== 0) throw new Error('restart-only security limits are rendered as inputs')
await shot('mineru-storage-desktop.png')

await mineru.getByRole('tab', { name: 'Service & parsing', exact: true }).click()
if (await baseUrlInput.inputValue() !== 'http://gpu-server:18000') throw new Error('tab switch discarded saved settings')
const desktopMetrics = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
}))

// Mobile.
await page.setViewportSize({ width: 390, height: 844 })
await serviceSection.waitFor({ timeout: 5000 })
if (bundleIntercepts !== 1) throw new Error(`workspace bundle was unexpectedly refetched ${bundleIntercepts} times`)
if (await credentialInput.inputValue() !== '') throw new Error('credential value was restored into the mobile browser')
await shot('mineru-connection-mobile.png')

await baseUrlInput.fill('http://mobile-edit:18000')
await actionBar.waitFor({ timeout: 5000 })
const barBox = await actionBar.boundingBox()
if (barBox === null || barBox.height > 56) throw new Error(`mobile action bar is not one compact row: ${JSON.stringify(barBox)}`)
await serviceSection.scrollIntoViewIfNeeded()
await shot('mineru-dirty-mobile.png', { full: false })
await actionBar.getByRole('button', { name: 'Discard', exact: true }).click()
if (await baseUrlInput.inputValue() !== 'http://gpu-server:18000') throw new Error('discard did not restore the saved value')
if (await actionBar.count() !== 0) throw new Error('action bar remained after discarding')

await mineru.getByRole('tab', { name: 'Storage', exact: true }).click()
await shot('mineru-storage-mobile.png')
const sectionBox = await mineru.boundingBox()
const visibleControlBoxes = await mineru.locator('input:visible, select:visible, button:visible').evaluateAll(elements => elements.map(element => {
  const box = element.getBoundingClientRect()
  return { tag: element.tagName, text: (element.textContent ?? '').trim().slice(0, 80), x: box.x, right: box.right, width: box.width }
}))
const mobileMetrics = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
}))
if (mobileMetrics.scrollWidth > mobileMetrics.clientWidth) throw new Error('mobile settings page has horizontal overflow')
const clippedControls = visibleControlBoxes.filter(box => box.x < 0 || box.right > 391)
if (clippedControls.length > 0) throw new Error(`mobile controls are clipped despite hidden document overflow: ${JSON.stringify(clippedControls)}`)
if (sectionBox === null || sectionBox.x < 0 || sectionBox.x + sectionBox.width > 390) {
  throw new Error(`mobile MinerU section is outside the viewport: ${JSON.stringify(sectionBox)}`)
}

// Dark theme.
const getInputBg = element => getComputedStyle(element.closest('span') ?? element).backgroundColor
await mineru.getByRole('tab', { name: 'Service & parsing', exact: true }).click()
const lightInputBackground = await credentialInput.evaluate(getInputBg)
await page.evaluate(() => {
  document.body.setAttribute('data-ds-dark-theme', '')
  document.documentElement.style.colorScheme = 'dark'
})
await shot('mineru-connection-dark-mobile.png')
const darkInputBackground = await credentialInput.evaluate(getInputBg)
if (lightInputBackground === darkInputBackground) throw new Error('input surface does not respond to the host dark palette')
await page.setViewportSize({ width: 1440, height: 1000 })
await shot('mineru-connection-dark-desktop.png')
await baseUrlInput.fill('http://dark-edit:18000')
await actionBar.waitFor({ timeout: 5000 })
await shot('mineru-dirty-dark-desktop.png', { full: false })
await actionBar.getByRole('button', { name: 'Discard', exact: true }).click()
await mineru.getByRole('tab', { name: 'Storage', exact: true }).click()
await shot('mineru-storage-dark-desktop.png')
await page.setViewportSize({ width: 390, height: 844 })
await shot('mineru-storage-dark-mobile.png')
await page.setViewportSize({ width: 1440, height: 1000 })
await page.evaluate(() => {
  document.body.removeAttribute('data-ds-dark-theme')
  document.documentElement.style.colorScheme = 'light'
})

if (errors.length > 0) throw new Error(`browser errors: ${errors.join('; ')}; failed requests: ${JSON.stringify(failedRequests)}`)
if (!credentialCalls.some(call => call.method === 'set' && call.ref === 'MINERU_API_KEY')) throw new Error('credential set did not use the Remote positional API')
if (!credentialCalls.some(call => call.method === 'unset' && call.ref === 'MINERU_API_KEY')) throw new Error('credential unset did not use the Remote positional API')
const probe = rpcCalls.find(call => call.endpoint === 'mineru/probe' && call.payload?.provider?.type === 'official-v4')
if (probe?.payload?.provider?.type !== 'official-v4') throw new Error('draft probe did not carry official provider')
const save = rpcCalls.find(call => call.endpoint === 'mineru/config.set')
if (save?.payload?.expected_revision !== 1) throw new Error('save was not bound to the loaded revision')
if (save?.payload?.config?.providers?.length !== 3) throw new Error('save did not carry all three provider profiles')
const savedLegacy = save.payload.config.providers.find(provider => provider.type === 'self-hosted-legacy-v2')
const savedOfficial = save.payload.config.providers.find(provider => provider.type === 'official-v4')
const savedV1 = save.payload.config.providers.find(provider => provider.type === 'self-hosted-v1')
if (savedLegacy?.baseURL !== 'http://gpu-server:18000') throw new Error('save reset the legacy profile')
if (savedOfficial?.baseURL !== 'https://mineru.net/api/v4') throw new Error('save reset the official profile')
if (savedV1?.tier !== 'advanced' || savedV1?.ocrMode !== 'txt' || savedV1?.baseURL !== 'http://v1-gpu:8000' || savedV1?.configuredVersion !== '4.0.10-review') throw new Error('save lost V1 settings')
if ('models' in savedLegacy || 'tier' in savedLegacy || 'modelMap' in savedOfficial || 'modelMap' in savedV1 || 'models' in savedV1) throw new Error('provider-specific fields leaked across profiles')
if (save.payload.config.retry.maxAttempts !== 4) throw new Error('save did not carry retry policy')
if (save.payload.config.output.maxInlineImages !== 9) throw new Error('save did not carry inline image budget')
const conflicted = rpcCalls.filter(call => call.endpoint === 'mineru/config.set')[1]
if (conflicted?.payload?.expected_revision !== 2) throw new Error('second save did not carry the refreshed revision')

const cacheClearDeleteCall = rpcCalls.find(call => call.endpoint === 'mineru/storage.cache.clear' && call.payload?.dry_run === false)
if (cacheClearDeleteCall?.payload?.confirm !== true) throw new Error('cache clear deletion did not carry explicit confirmation')
if (cacheClearDeleteCall?.payload?.confirmation_token !== 'cache-clear-preview-token') throw new Error('cache clear deletion was not bound to its preview')
const cleanupPreviewCall = rpcCalls.find(call => call.endpoint === 'mineru/storage.quarantine.cleanup' && call.payload?.dry_run === true)
if (JSON.stringify(cleanupPreviewCall?.payload?.entry_ids) !== '["entry_corrupt_1"]') throw new Error('cleanup preview did not carry the selected entry')
const cleanupDeleteCall = rpcCalls.find(call => call.endpoint === 'mineru/storage.quarantine.cleanup' && call.payload?.dry_run === false)
if (cleanupDeleteCall?.payload?.confirm !== true || JSON.stringify(cleanupDeleteCall.payload.entry_ids) !== '["entry_corrupt_1"]') throw new Error('cleanup deletion was not limited to the previewed entries')

const screenshots = [
  'mineru-connection-desktop.png', 'mineru-dirty-desktop.png', 'mineru-v1-desktop.png', 'mineru-official-desktop.png',
  'mineru-dirty-advanced-desktop.png', 'mineru-conflict-desktop.png', 'mineru-clear-dialog-desktop.png', 'mineru-storage-desktop.png',
  'mineru-connection-mobile.png', 'mineru-dirty-mobile.png', 'mineru-storage-mobile.png',
  'mineru-connection-dark-mobile.png', 'mineru-connection-dark-desktop.png', 'mineru-dirty-dark-desktop.png',
  'mineru-storage-dark-desktop.png', 'mineru-storage-dark-mobile.png',
].map(name => join(screenshotDir, name))
console.log(JSON.stringify({
  providerSwitch: true, scopedNotices: true, draftProbe: true, save: true, conflict: true, credentialUi: true, maintenance: true,
  errors, desktopMetrics, mobileMetrics, sectionBox, mobileActionBar: barBox,
  rpcEndpoints: rpcCalls.map(call => call.endpoint),
  credentialCalls,
  pluginManagerCalls,
  bundleConfiguration: 'dsh-pdf-mineru',
  absentFromGlobalSettings: true,
  unrelatedPluginErrors: [...unrelatedPluginErrors],
  excludedPluginIds: [...excludedPluginIds],
  bundleIntercepts,
  hmrIsolated: true,
  screenshots,
}, null, 2))
await browser.close()