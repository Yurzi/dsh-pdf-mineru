#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { chmod, lstat, mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, resolve } from 'node:path'

function usage() {
  console.log(`Usage:
  MINERU_API_KEY=<token> pnpm run smoke:official-v4 -- <pdf> [options]

Options:
  --model <pipeline|vlm>  Parsing model (default: pipeline)
  --ocr                   Force OCR
  --lang <language>       MinerU language value (default: ch)
  --timeout <ms>          Synchronous parse timeout (default: 600000)
  --base-url <https-url>  Official v4 API base URL
  --keep-storage          Keep the temporary result store
  --help                  Show this help
`)
}

function fail(message) {
  console.error(`[official-v4-smoke] ${message}`)
  process.exitCode = 1
}

function parseArgs(argv) {
  const options = {
    pdf: process.env.MINERU_TEST_PDF,
    model: 'pipeline',
    ocr: false,
    language: 'ch',
    timeoutMs: 600000,
    baseURL: process.env.MINERU_BASE_URL ?? 'https://mineru.net/api/v4',
    keepStorage: false,
  }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--') continue
    if (arg === '--help' || arg === '-h') return { help: true }
    if (arg === '--ocr') { options.ocr = true; continue }
    if (arg === '--keep-storage') { options.keepStorage = true; continue }
    if (arg === '--model' || arg === '--lang' || arg === '--timeout' || arg === '--base-url') {
      const value = argv[++index]
      if (value === undefined) throw new TypeError(`${arg} requires a value`)
      if (arg === '--model') options.model = value
      if (arg === '--lang') options.language = value
      if (arg === '--timeout') options.timeoutMs = Number(value)
      if (arg === '--base-url') options.baseURL = value
      continue
    }
    if (arg.startsWith('-')) throw new TypeError(`unknown option: ${arg}`)
    if (options.pdf !== undefined) throw new TypeError('only one PDF may be supplied')
    options.pdf = arg
  }
  if (options.model !== 'pipeline' && options.model !== 'vlm') throw new TypeError('--model must be pipeline or vlm')
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1000 || options.timeoutMs > 3600000) {
    throw new TypeError('--timeout must be an integer between 1000 and 3600000')
  }
  const parsedBase = new URL(options.baseURL)
  if (parsedBase.protocol !== 'https:' || parsedBase.username || parsedBase.password || parsedBase.search || parsedBase.hash) {
    throw new TypeError('--base-url must be HTTPS without credentials, query, or fragment')
  }
  options.baseURL = parsedBase.toString().replace(/\/$/, '')
  return options
}

async function makeWritable(path) {
  let details
  try { details = await lstat(path) } catch { return }
  if (details.isSymbolicLink()) return
  if (details.isDirectory()) {
    await chmod(path, 0o700).catch(() => undefined)
    const entries = await readdir(path).catch(() => [])
    for (const entry of entries) await makeWritable(resolve(path, entry))
  } else if (details.isFile()) {
    await chmod(path, 0o600).catch(() => undefined)
  }
}

function createContext(definitions) {
  const discard = () => undefined
  return {
    tools: {
      register(definition) { definitions.push(definition); return discard },
      schemas() { return [] },
    },
    get() { return undefined },
    inject() { return discard },
    effect() { return discard },
    on() { return discard },
    logger: { debug: discard, info: discard, warn: discard, error: discard },
  }
}

function summarize(result) {
  return {
    state: result.state,
    provider: result.provider ?? 'official-v4',
    job_id: result.job_id,
    result_id: result.result_id,
    cache_hit: result.cache_hit,
    preview_chars: typeof result.markdown_preview === 'string' ? result.markdown_preview.length : 0,
    preview_truncated: result.preview_truncated,
    files: Array.isArray(result.files) ? result.files.map(file => ({
      name: file.name,
      state: file.state,
      artifacts: Array.isArray(file.artifacts)
        ? file.artifacts.map(artifact => ({ kind: artifact.kind, bytes: artifact.bytes }))
        : [],
    })) : [],
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) { usage(); return }
  const token = process.env.MINERU_API_KEY
  if (typeof token !== 'string' || token.trim() === '') {
    fail('MINERU_API_KEY is required; this smoke test is explicitly opt-in')
    return
  }
  if (options.pdf === undefined) { fail('a PDF path is required'); return }

  const pdfPath = resolve(options.pdf)
  const source = await stat(pdfPath).catch(() => undefined)
  if (source === undefined || !source.isFile()) { fail('the supplied PDF is not a regular file'); return }
  if (source.size <= 0) { fail('the supplied PDF is empty'); return }

  const storageRoot = await mkdtemp(resolve(tmpdir(), 'dsh-pdf-mineru-smoke-'))
  const definitions = []
  let dispose
  const controller = new AbortController()
  const overallTimer = setTimeout(() => {
    controller.abort(new DOMException('Smoke test timed out', 'TimeoutError'))
  }, options.timeoutMs + 60000)
  const onInterrupt = () => controller.abort(new DOMException('Smoke test interrupted', 'AbortError'))
  process.once('SIGINT', onInterrupt)
  process.once('SIGTERM', onInterrupt)

  try {
    const plugin = await import('../lib/index.js')
    const providerId = 'mp_official_smoke'
    const base = plugin.defaultMinerUConfig()
    const config = plugin.migrateConfig({
      ...base,
      activeProvider: providerId,
      providers: [{
        id: providerId,
        type: 'official-v4',
        baseURL: options.baseURL,
        apiKeyEnv: 'MINERU_API_KEY',
        models: ['pipeline', 'vlm'],
        configuredVersion: 'v4',
      }],
      defaults: {
        ...base.defaults, model: options.model, ocr: options.ocr,
        parseMethod: options.ocr ? 'ocr' : 'auto', language: options.language,
      },
      storage: { ...base.storage, storageRoot },
      polling: {
        ...base.polling, pollTimeoutMs: options.timeoutMs,
        operationTimeoutMs: Math.min(3600000, options.timeoutMs + 60000),
      },
    })
    dispose = await plugin.apply(createContext(definitions), config)
    const tool = definitions.find(definition => definition?.name === 'mineru_parse_document')
    if (tool === undefined || typeof tool.execute !== 'function') throw new Error('mineru_parse_document was not registered')
    const args = {
      file_paths: [pdfPath], model: options.model, ocr: options.ocr, language: options.language,
      artifacts: ['markdown'], poll_timeout_ms: options.timeoutMs,
    }
    const session = { header: { id: `smoke-${randomUUID()}`, cwd: process.cwd() } }
    const result = await tool.execute(args, {
      signal: controller.signal, callId: randomUUID(), name: 'mineru_parse_document', arguments: args,
      agent: { id: 'official-v4-smoke', session },
    })
    console.log(JSON.stringify(summarize(result), null, 2))
    if (result.state !== 'completed' && result.state !== 'partially-completed') {
      fail(`parse finished in state ${String(result.state)}`)
    }
  } catch (error) {
    const code = error?.failure?.code ?? error?.name ?? 'UNKNOWN_ERROR'
    fail(`failed with ${String(code)}`)
  } finally {
    clearTimeout(overallTimer)
    process.removeListener('SIGINT', onInterrupt)
    process.removeListener('SIGTERM', onInterrupt)
    await dispose?.().catch(() => undefined)
    if (options.keepStorage) {
      console.log('[official-v4-smoke] temporary storage retained')
    } else {
      await makeWritable(storageRoot)
      await rm(storageRoot, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

await main()
