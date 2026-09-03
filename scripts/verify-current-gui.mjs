import { createHash, createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
const requestedWebUrl = new URL(
  process.env.DSH_WEB_AUTH_URL ?? process.env.DSH_WEB_URL ?? 'http://127.0.0.1:3080',
)
const webUrl = new URL(requestedWebUrl)
webUrl.search = ''
webUrl.hash = ''
const clientInject = [
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-api-remotes',
]

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
  const retainedEntries = boot.entries.filter(entry => entry.id !== pluginId)
  const retainedById = new Map(retainedEntries.map(entry => [entry.id, entry]))
  const retainedBatches = []
  for (const batch of boot.batches) {
    if (!Array.isArray(batch.entries)) throw new Error('DSH shell boot batch has no entries')
    if (!batch.entries.includes(pluginId)) {
      retainedBatches.push(batch)
      continue
    }
    // A combo containing the installed MinerU bundle must not remain the
    // initial URL for its neighbours: split those rows onto their single-entry
    // URLs so the stale factory can be preloaded but never executed.
    for (const id of batch.entries.filter(entryId => entryId !== pluginId)) {
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
  schemaVersion: 1,
  activeProvider: 'mp_self_hosted',
  providers: [{
    id: 'mp_self_hosted', type: 'self-hosted-v2', baseURL: 'http://localhost:18000',
    apiKeyEnv: 'MINERU_API_KEY', modelMap: { pipeline: 'pipeline', vlm: 'vlm-engine' }, allowInsecureHttp: true,
  }],
  defaults: { model: 'pipeline', ocr: false, parseMethod: 'auto', language: 'ch', formula: true, table: true, artifacts: ['markdown'] },
  storage: { storageRoot: '/tmp/mineru-ui-verification', cacheEnabled: true, retainSources: false, stagingTtlMs: 86400000 },
  polling: { pollIntervalMs: 2000, pollTimeoutMs: 600000, requestTimeoutMs: 60000, operationTimeoutMs: 3600000 },
  retry: { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 10000 },
  output: { maxInlineChars: 200000 },
  limits: {
    maxFilesPerRequest: 1, maxFileBytes: 209715200, maxApiResponseBytes: 8388608,
    maxZipDownloadBytes: 536870912, maxZipEntries: 10000, maxZipEntryBytes: 268435456,
    maxZipTotalBytes: 2147483648, maxZipCompressionRatio: 200,
  },
}

const storageArea = (byteUsage, logicalEntryCount) => ({
  byteUsage, byteUsageSaturated: false, logicalEntryCount, regularFileCount: logicalEntryCount,
  directoryCount: logicalEntryCount, skippedSymlinkCount: 0, unexpectedEntryCount: 0,
  unreadableEntryCount: 0, depthLimitCount: 0,
})
const storageStats = {
  generatedAt: Date.now(),
  publishedResults: storageArea(4096, 2),
  staging: storageArea(1024, 1), quarantine: storageArea(512, 2),
}
const integrityScan = {
  generatedAt: Date.now(), readOnly: true, isolateInvalid: false, validCount: 2, corruptCount: 0,
  missingCount: 0, unreadableCount: 0, quarantinedCount: 0,
  scan: { limit: 10000, scanned: 2, truncated: false, diagnosticsLimit: 50, diagnosticsTruncated: false },
  diagnostics: [],
}
const gcPreview = {
  generatedAt: Date.now(), dryRun: true, referencePolicy: 'no-plugin-job-retention', eligible: true,
  candidateCount: 2, candidateBytes: 4096, candidateBytesSaturated: false,
  candidates: [{ cacheKey: 'a'.repeat(64), resultId: 'mr_' + 'a'.repeat(32), byteUsage: 2048, byteUsageSaturated: false }],
  candidatesTruncated: true, candidateTotalsComplete: true, referencedResultCount: 0,
  invalidResultCount: 0, unsafeResultCount: 0,
  jobReferences: { complete: true, sessionJobCount: 0, activeJobCount: 0, referencedCacheKeyCount: 0 },
  scan: { limit: 10000, scanned: 2, truncated: false, diagnosticsLimit: 50, diagnosticsTruncated: false }, diagnostics: [],
}
const cacheClearReport = dryRun => ({
  generatedAt: Date.now(), dryRun, eligible: true, activeJobCount: 0, activeOperationCount: 0, activeAccessCount: 0,
  ...(dryRun ? { confirmationToken: 'cache-clear-preview-token' } : {}),
  plannedCount: 2, plannedBytes: 4096, plannedBytesSaturated: false,
  deletedCount: dryRun ? 0 : 2, deletedBytes: dryRun ? 0 : 4096, deletedBytesSaturated: false,
  skippedCount: 0,
  jobScan: { complete: true, sessionJobCount: 3, activeJobCount: 0, referencedCacheKeyCount: 1 },
  scan: { limit: 10000, scanned: 2, truncated: false, diagnosticsLimit: 50, diagnosticsTruncated: false },
  diagnostics: [],
})

const quarantineReport = {
  generatedAt: Date.now(),
  entries: [
    { id: 'entry_corrupt_1', byteUsage: 256, byteUsageSaturated: false, regularFileCount: 1, directoryCount: 1, modifiedAt: Date.now() },
    { id: 'entry_corrupt_2', byteUsage: 256, byteUsageSaturated: false, regularFileCount: 1, directoryCount: 1, modifiedAt: Date.now() },
  ],
  totalCount: 2, totalBytes: 512, totalBytesSaturated: false, truncated: false,
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
const rpcCalls = []
const credentialCalls = []
let credentialConfigured = true
let bundleIntercepts = 0
page.on('console', message => {
  if (message.type() === 'error') {
    const text = message.text()
    if (!text.includes('sidebar/ws') && !text.includes('dsh-better-sidebar')) {
      errors.push(text)
    }
  }
})
page.on('pageerror', error => {
  if (!error.message.includes('remote.session')) {
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
    return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: bundle })
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
  if (endpoint === 'mineru/config.get') result = { ok: true, value: { config } }
  else if (endpoint === 'mineru/config.set') result = { ok: true, value: { config: payload.config } }
  else if (endpoint === 'mineru/probe') result = {
    ok: true, value: { available: true, provider: payload.provider.type, authentication: 'valid', protocol_version: payload.provider.type === 'official-v4' ? 'v4' : 'v2' },
  }
  else if (endpoint === 'mineru/storage.stats') result = { ok: true, value: storageStats }
  else if (endpoint === 'mineru/storage.integrity.scan') result = { ok: true, value: integrityScan }
  else if (endpoint === 'mineru/storage.gc.preview') result = { ok: true, value: gcPreview }
  else if (endpoint === 'mineru/storage.cache.clear') result = { ok: true, value: cacheClearReport(payload.dry_run !== false) }
  else if (endpoint === 'mineru/storage.quarantine.list') result = { ok: true, value: quarantineReport }
  else if (endpoint === 'mineru/storage.quarantine.cleanup') result = {
    ok: true,
    value: {
      generatedAt: Date.now(), dryRun: payload.dry_run !== false, requestedCount: payload.entry_ids.length,
      plannedCount: payload.entry_ids.length, plannedBytes: 256, plannedBytesSaturated: false,
      deletedCount: payload.dry_run === false ? payload.entry_ids.length : 0,
      deletedBytes: payload.dry_run === false ? 256 : 0, deletedBytesSaturated: false,
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
await page.waitForTimeout(1000)
await page.getByRole('button', { name: 'Settings', exact: true }).click()
await page.waitForTimeout(300)
await page.getByRole('button', { name: 'MinerU', exact: true }).click()
await page.waitForTimeout(1500)
if (await page.getByText('Provider Settings', { exact: true }).count() === 0) {
  console.error(JSON.stringify({ bundleIntercepts, rpcCalls, credentialCalls, errors, body: (await page.locator('body').innerText()).slice(0, 8000) }, null, 2))
}
await page.getByText('Provider Settings', { exact: true }).waitFor({ timeout: 10_000 })
if (bundleIntercepts !== 1) throw new Error(`workspace bundle was fetched ${bundleIntercepts} times during desktop boot`)
const credentialInput = page.getByLabel('API Key', { exact: true })
await credentialInput.waitFor({ timeout: 5000 })
if (await credentialInput.getAttribute('type') !== 'password') throw new Error('API key control is not a password input')
if (await credentialInput.inputValue() !== '') throw new Error('credential value was restored into the browser')
if (await page.getByRole('button', { name: 'Clear API Key', exact: true }).count() !== 1) throw new Error('credential clear control is missing')
await page.getByText('Provider Settings', { exact: true }).scrollIntoViewIfNeeded()
await page.screenshot({ path: '/tmp/mineru-current-settings-credential-desktop.png', fullPage: true })
const activeProvider = page.getByLabel('Active Provider')
if (await activeProvider.inputValue() !== 'mp_self_hosted') throw new Error('initial active provider mismatch')
if (await activeProvider.locator('option').count() !== 2) throw new Error('legacy single-provider config was not completed with both profiles')
if (await page.getByText('Pipeline Backend Map', { exact: true }).count() !== 1) throw new Error('self-hosted fields are missing')
const baseUrlInput = page.getByLabel('API Base URL')
await baseUrlInput.fill('http://gpu-server:18000')
await activeProvider.selectOption('mp_official')
if (await page.getByText('Supported Cloud Models', { exact: true }).count() !== 1) throw new Error('official fields are missing')
if (await page.getByText('Pipeline Backend Map', { exact: true }).count() !== 0) throw new Error('self-hosted fields leaked into official profile')
if (await baseUrlInput.inputValue() !== 'https://mineru.net/api/v4') throw new Error('official profile did not retain its independent base URL')
if (await page.getByLabel('Default Parse Method').locator('option[value=txt]').count() !== 0) throw new Error('official mode exposes unsupported txt method')
await page.getByRole('button', { name: 'Test Active Provider', exact: true }).click()
await page.getByText(/Connection Healthy/).waitFor({ timeout: 5000 })
await activeProvider.selectOption('mp_self_hosted')
if (await baseUrlInput.inputValue() !== 'http://gpu-server:18000') throw new Error('self-hosted profile was reset after switching providers')
await page.getByLabel('Maximum Attempts').fill('4')
await credentialInput.fill('gui-verifier-secret')
await page.getByRole('button', { name: 'Save Configuration', exact: true }).click()
await page.getByRole('button', { name: 'Saved', exact: true }).waitFor({ timeout: 5000 })
await page.getByText('A credential is configured. Saving with this field blank keeps it unchanged.', { exact: false }).waitFor({ timeout: 5000 })
if (await credentialInput.inputValue() !== '') throw new Error('credential input retained the submitted secret')
await page.getByRole('button', { name: 'Clear API Key', exact: true }).click()
await page.getByText('No credential is configured. Enter a key and save the configuration to store it.', { exact: true }).waitFor({ timeout: 5000 })
await page.getByRole('button', { name: 'Refresh Statistics', exact: true }).click()
await page.getByText('Published Results', { exact: true }).waitFor({ timeout: 5000 })
await page.getByRole('button', { name: 'Verify Cache', exact: true }).click()
await page.getByText('Valid: 2', { exact: true }).waitFor({ timeout: 5000 })
await page.getByRole('button', { name: 'Preview GC', exact: true }).click()
await page.getByText('Complete Preview', { exact: true }).waitFor({ timeout: 5000 })
await page.getByRole('button', { name: 'Clear Cache', exact: true }).click()
await page.getByText('Ready to Clear', { exact: true }).waitFor({ timeout: 5000 })
await page.getByRole('button', { name: 'Preview GC', exact: true }).click()
if (await page.getByRole('button', { name: 'Confirm Clear', exact: true }).count() !== 0) throw new Error('cache clear confirmation stayed armed after another operation')
await page.getByRole('button', { name: 'Clear Cache', exact: true }).click()
await page.getByRole('button', { name: 'Confirm Clear', exact: true }).click()
await page.getByText('Deleted: 2', { exact: true }).waitFor({ timeout: 5000 })
await page.getByRole('button', { name: 'List Quarantine', exact: true }).click()
await page.getByText('entry_corrupt_1', { exact: true }).waitFor({ timeout: 5000 })
await page.getByLabel('entry_corrupt_1').check()
await page.getByRole('button', { name: 'Preview Cleanup', exact: true }).click()
await page.getByText('Planned: 1', { exact: true }).waitFor({ timeout: 5000 })
await page.getByRole('button', { name: 'Delete Selected', exact: true }).click()
await page.getByRole('button', { name: 'Confirm Delete', exact: true }).click()
await page.getByText('Deleted: 1', { exact: true }).waitFor({ timeout: 5000 })
await page.getByText('Storage Operations', { exact: true }).evaluate(element => element.scrollIntoView({ block: 'center' }))
await page.screenshot({ path: '/tmp/mineru-current-settings-desktop.png', fullPage: true })

const desktopMetrics = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
}))
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(500)
await page.getByText('Provider Settings', { exact: true }).waitFor({ timeout: 5000 })
if (bundleIntercepts !== 1) throw new Error(`workspace bundle was unexpectedly refetched ${bundleIntercepts} times`)
const mobileCredentialInput = page.getByLabel('API Key', { exact: true })
await mobileCredentialInput.waitFor({ timeout: 5000 })
if (await mobileCredentialInput.inputValue() !== '') throw new Error('credential value was restored into the mobile browser')
await page.getByText('Provider Settings', { exact: true }).scrollIntoViewIfNeeded()
await page.screenshot({ path: '/tmp/mineru-current-settings-credential-mobile.png', fullPage: true })
await page.getByRole('button', { name: 'List Quarantine', exact: true }).click()
await page.getByText('entry_corrupt_1', { exact: true }).waitFor({ timeout: 5000 })
await page.getByText('Storage & Cache', { exact: true }).scrollIntoViewIfNeeded()
await page.screenshot({ path: '/tmp/mineru-current-settings-mobile.png', fullPage: true })
const providerHeadingBox = await page.getByText('Provider Settings', { exact: true }).boundingBox()
const mineruSection = page.getByRole('heading', { name: 'MinerU Configuration', exact: true }).locator('xpath=ancestor::section[1]')
const sectionBox = await mineruSection.boundingBox()
const layoutDiagnostics = await page.evaluate(() => {
  const heading = text => [...document.querySelectorAll('h3')].find(element => element.textContent?.trim() === text)
  const rect = element => {
    if (!element) return null
    const box = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return {
      x: box.x, y: box.y, width: box.width, height: box.height, display: style.display, flex: style.flex,
      gap: style.gap, flexDirection: style.flexDirection, flexWrap: style.flexWrap, alignContent: style.alignContent,
      minHeight: style.minHeight, maxHeight: style.maxHeight,
    }
  }
  const storage = heading('Storage & Cache')?.parentElement
  const operations = heading('Storage Operations')?.parentElement
  const polling = heading('Polling & Timeouts')?.parentElement
  const ttl = [...document.querySelectorAll('input')].find(input => input.previousElementSibling?.textContent?.trim() === 'Staging Cleanup TTL (ms)')
  const cache = [...document.querySelectorAll('input[type=checkbox]')].find(input => input.parentElement?.textContent?.includes('Enable Global Cache'))
  const matchingFlexRules = element => {
    if (!element) return []
    const matches = []
    const visit = (rules, source) => {
      for (const rule of rules) {
        if ('cssRules' in rule) { try { visit(rule.cssRules, source) } catch {} }
        if ('selectorText' in rule && rule.style?.flexDirection) {
          try { if (element.matches(rule.selectorText)) matches.push({ source, selector: rule.selectorText, flexDirection: rule.style.flexDirection }) } catch {}
        }
      }
    }
    for (const sheet of document.styleSheets) { try { visit(sheet.cssRules, sheet.href ?? 'inline') } catch {} }
    return matches
  }
  const storageRow = storage?.querySelector('[class*=row]')
  return {
    storage: rect(storage), operations: rect(operations), polling: rect(polling),
    ttl: rect(ttl), cache: rect(cache), storageChildren: storage ? [...storage.children].map(rect) : [],
    storageRows: storage ? [...storage.querySelectorAll('[class*=row]')].map(row => ({ row: rect(row), children: [...row.children].map(rect) })) : [],
    storageRowFlexRules: matchingFlexRules(storageRow),
  }
})
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
if (errors.length > 0) throw new Error(`browser errors: ${errors.join('; ')}`)
if (!credentialCalls.some(call => call.method === 'set' && call.ref === 'MINERU_API_KEY')) throw new Error('credential set did not use the Remote positional API')
if (!credentialCalls.some(call => call.method === 'unset' && call.ref === 'MINERU_API_KEY')) throw new Error('credential unset did not use the Remote positional API')
const probe = rpcCalls.find(call => call.endpoint === 'mineru/probe')
if (probe?.payload?.provider?.type !== 'official-v4') throw new Error('draft probe did not carry official provider')
const save = rpcCalls.find(call => call.endpoint === 'mineru/config.set')
if (save?.payload?.config?.providers?.length !== 2) throw new Error('save did not carry both provider profiles')
const savedSelfHosted = save?.payload?.config?.providers?.find(provider => provider.type === 'self-hosted-v2')
const savedOfficial = save?.payload?.config?.providers?.find(provider => provider.type === 'official-v4')
if (savedSelfHosted?.baseURL !== 'http://gpu-server:18000') throw new Error('save reset the self-hosted profile')
if (savedOfficial?.baseURL !== 'https://mineru.net/api/v4') throw new Error('save reset the official profile')
if ('models' in savedSelfHosted || 'modelMap' in savedOfficial) throw new Error('provider-specific fields leaked across profiles')
if (save?.payload?.config?.retry?.maxAttempts !== 4) throw new Error('save did not carry retry policy')
const cacheClearPreviewCall = rpcCalls.find(call => call.endpoint === 'mineru/storage.cache.clear' && call.payload?.dry_run === true)
if (cacheClearPreviewCall === undefined) throw new Error('cache clear preview was not requested')
const cacheClearDeleteCall = rpcCalls.find(call => call.endpoint === 'mineru/storage.cache.clear' && call.payload?.dry_run === false)
if (cacheClearDeleteCall?.payload?.confirm !== true) throw new Error('cache clear deletion did not carry explicit confirmation')
if (cacheClearDeleteCall?.payload?.confirmation_token !== 'cache-clear-preview-token') throw new Error('cache clear deletion was not bound to its preview')
const cleanupPreviewCall = rpcCalls.find(call => call.endpoint === 'mineru/storage.quarantine.cleanup' && call.payload?.dry_run === true)
if (cleanupPreviewCall?.payload?.entry_ids?.[0] !== 'entry_corrupt_1') throw new Error('cleanup preview did not carry selected entry')
const cleanupDeleteCall = rpcCalls.find(call => call.endpoint === 'mineru/storage.quarantine.cleanup' && call.payload?.dry_run === false)
if (cleanupDeleteCall?.payload?.confirm !== true) throw new Error('cleanup deletion did not carry explicit confirmation')
console.log(JSON.stringify({
  providerSwitch: true, draftProbe: true, save: true, credentialUi: true, maintenance: true, errors, desktopMetrics, mobileMetrics, sectionBox, providerHeadingBox, layoutDiagnostics, visibleControlBoxes,
  rpcEndpoints: rpcCalls.map(call => call.endpoint),
  credentialCalls,
  bundleIntercepts,
  screenshots: [
    '/tmp/mineru-current-settings-credential-desktop.png',
    '/tmp/mineru-current-settings-desktop.png',
    '/tmp/mineru-current-settings-credential-mobile.png',
    '/tmp/mineru-current-settings-mobile.png',
  ],
}, null, 2))
await browser.close()