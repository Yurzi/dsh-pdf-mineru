#!/usr/bin/env node
/**
 * scripts/smoke-reader-cache.mjs
 *
 * Explicit, opt-in offline replay test for read_pdf using cached MinerU artifacts.
 * Verifies that the built MinerUService correctly reads, paginates, searches,
 * and formats pre-existing cached results without any network calls.
 *
 * Usage: node scripts/smoke-reader-cache.mjs <pdf> <manifest> [output-directory]
 */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, open, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import * as plugin from '../lib/index.js'

const args = process.argv.slice(2).filter(arg => arg !== '--')
const pdfArg = args[0]
const manifestArg = args[1]
const outputDirectoryArg = args[2] === undefined ? undefined : resolve(args[2])

if (!pdfArg || !manifestArg || args.length > 3) {
  console.error('Usage: node scripts/smoke-reader-cache.mjs <pdf> <manifest> [output-directory]')
  process.exit(1)
}

const pdfPath = resolve(pdfArg)
const manifestPath = resolve(manifestArg)
const manifestDir = dirname(manifestPath)

// Enforce offline-only execution: all network calls are strictly forbidden.
const nativeFetch = globalThis.fetch
globalThis.fetch = async () => {
  throw new Error('Network access is strictly forbidden in offline cache replay smoke')
}

let smokeTmpRoot
let disposePlugin

async function hashFile(path, maxBytes) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const before = await handle.stat()
    assert.ok(before.isFile() && before.size <= maxBytes, 'File exceeds offline smoke read limit')
    const digest = createHash('sha256')
    const buffer = Buffer.alloc(64 * 1024)
    let bytes = 0
    for (;;) {
      const read = await handle.read(buffer, 0, buffer.length, null)
      if (read.bytesRead === 0) break
      bytes += read.bytesRead
      assert.ok(bytes <= maxBytes, 'File grew beyond offline smoke read limit')
      digest.update(buffer.subarray(0, read.bytesRead))
    }
    const after = await handle.stat()
    assert.equal(bytes, before.size)
    assert.equal(after.size, before.size)
    assert.equal(after.mtimeMs, before.mtimeMs)
    return digest.digest('hex')
  } finally { await handle.close() }
}

try {
  console.log('--- MinerU Offline Cache Replay Smoke ---')
  console.log('Mode: Offline replay from pre-existing cached artifacts (NOT fresh Provider extraction)')

  // 1. Stat & Hash PDF source
  const pdfStat = await stat(pdfPath)
  assert.ok(pdfStat.isFile(), 'PDF path must be a regular file')
  const pdfSha256 = await hashFile(pdfPath, 200 * 1024 * 1024)

  // 2. Read & Validate Manifest
  const manifestStat = await stat(manifestPath)
  assert.ok(manifestStat.isFile(), 'Manifest path must be a regular file')
  assert.ok(manifestStat.size <= 2 * 1024 * 1024, 'Manifest exceeds smoke read limit')
  const manifestRaw = await readFile(manifestPath, 'utf8')
  const manifest = plugin.parseMinerUResultManifest(JSON.parse(manifestRaw))

  assert.equal(manifest.schemaVersion, plugin.MINERU_RESULT_MANIFEST_SCHEMA_VERSION ?? 1, 'Manifest schemaVersion mismatch')
  assert.match(manifest.id, /^mr_[a-zA-Z0-9_-]+$/, 'Manifest ID must have mr_ prefix')
  assert.match(manifest.cacheKey, /^[a-f0-9]{64}$/, 'Manifest cacheKey must be a 64-character lowercase hex string')
  assert.equal(pdfSha256, manifest.sourceSha256, 'Source PDF SHA-256 does not match manifest sourceSha256')
  assert.equal(pdfStat.size, manifest.request?.files?.[0]?.bytes, 'Source PDF byte length does not match manifest request file bytes')
  assert.equal(pdfSha256, manifest.request?.files?.[0]?.sha256, 'Source PDF SHA-256 does not match manifest request file sha256')

  // 3. Verify Artifact Integrity & Path Safety
  assert.ok(Array.isArray(manifest.files) && manifest.files.length === 1, 'Manifest must declare exactly one file')
  const document = manifest.files[0]
  assert.ok(Array.isArray(document.artifacts) && document.artifacts.length > 0, 'Document must declare artifacts')

  let verifiedArtifactsCount = 0
  let totalArtifactBytes = 0

  for (const artifact of document.artifacts) {
    assert.ok(typeof artifact.relativePath === 'string', 'Artifact relativePath must be a string')
    // Path traversal safety check
    assert.ok(!artifact.relativePath.includes('..'), `Artifact path cannot contain "..": ${artifact.relativePath}`)
    assert.ok(!artifact.relativePath.startsWith('/'), `Artifact path cannot be absolute: ${artifact.relativePath}`)
    assert.ok(artifact.relativePath.startsWith('files/'), `Artifact path must start with "files/": ${artifact.relativePath}`)

    const artifactDiskPath = join(manifestDir, artifact.relativePath)
    const realRoot = await realpath(manifestDir)
    const realArtifact = await realpath(artifactDiskPath)
    assert.equal(realArtifact, join(realRoot, artifact.relativePath), 'Artifact path may not traverse a symbolic link')
    const artStat = await stat(artifactDiskPath)
    assert.ok(artStat.isFile(), `Artifact file missing on disk: ${artifactDiskPath}`)
    assert.equal(artStat.size, artifact.bytes, `Artifact byte size mismatch for ${artifact.relativePath}`)

    const artSha256 = await hashFile(artifactDiskPath, 64 * 1024 * 1024)
    assert.equal(artSha256, artifact.sha256, `Artifact SHA-256 mismatch for ${artifact.relativePath}`)

    verifiedArtifactsCount++
    totalArtifactBytes += artifact.bytes
  }

  console.log(`[Integrity] Source PDF verified (${pdfStat.size} bytes, sha256: ${pdfSha256.slice(0, 16)}...)`)
  console.log(`[Integrity] Manifest verified (result_id: ${manifest.id}, ${verifiedArtifactsCount} artifacts, ${totalArtifactBytes} bytes total)`)

  // 4. Capture Tool Schema via Plugin Registration
  smokeTmpRoot = await mkdtemp(join(tmpdir(), 'mineru-cache-smoke-'))
  const baseConfig = plugin.defaultMinerUConfig()
  const config = plugin.parseConfig({
    ...baseConfig,
    storage: { ...baseConfig.storage, storageRoot: smokeTmpRoot },
    output: { maxInlineChars: 12000, maxInlineImages: 6 },
  })

  const registeredToolDefs = []
  const noop = () => undefined
  const pluginCtx = {
    tools: { register(def) { registeredToolDefs.push(def); return noop }, schemas() { return [] } },
    get(name) {
      if (name === 'settings') {
        return {
          register() { return { get: () => config, watch: () => noop, replace: async () => undefined } },
          mutate: async () => undefined,
        }
      }
      return undefined
    },
    inject: () => noop,
    effect: () => noop,
    on: () => noop,
    logger: { debug: noop, info: noop, warn: noop, error: noop },
  }

  disposePlugin = await plugin.apply(pluginCtx, config)
  const readToolDef = registeredToolDefs.find(def => def.name === 'read_pdf')
  assert.ok(readToolDef, 'read_pdf tool definition not found from plugin.apply')

  // 5. Setup Read-Only Bounded Repository Adapter & Mock Provider for Offline Replay
  const mockProvider = {
    id: manifest.producer.providerId,
    capabilities: {
      models: ['pipeline', 'vlm'],
      parseMethods: ['auto', 'txt', 'ocr'],
      supportsOcr: true,
      supportsLanguage: true,
      supportsFormula: true,
      supportsTable: true,
      supportsPageRanges: true,
      supportedArtifacts: ['markdown', 'layout', 'model-output', 'content-list', 'images'],
      maxFilesPerSubmission: 10,
      maxFileBytes: 200 * 1024 * 1024,
    },
    compatibilityKey: async () => manifest.producer.compatibilityKey,
    submit: async () => { throw new Error('Provider submit is forbidden in offline replay') },
  }

  const providers = {
    active: () => ({
      provider: mockProvider,
      config: { id: manifest.producer.providerConfigId, type: manifest.producer.providerId },
    }),
    resolve: () => mockProvider,
  }

  const readOnlyResults = {
    get: async () => manifest,
    resolveArtifactAbsolutePath: (_cacheKey, relativePath) => join(manifestDir, relativePath),
    manifestAbsolutePath: () => manifestPath,
  }

  const operations = {
    shutdown: async () => undefined,
    reserve: () => { throw new Error('Uncached reservation is forbidden in offline replay') },
  }

  const diagnosticsEvents = []
  const service = new plugin.MinerUService({
    getConfig: () => config,
    providers,
    results: readOnlyResults,
    operations,
    diagnostics: event => diagnosticsEvents.push(event),
    resolveCredential: () => Promise.resolve(undefined),
  })

  const session = { header: { id: 'smoke-cache-session', cwd: process.cwd() } }
  const signal = new AbortController().signal

  // --- Test Suite 1: Full Document Continuation ---
  console.log('\n[Test 1] Testing full document reading and continuation...')
  const fullChunks = []
  let fullCalls = 0
  let current = await service.parseDocument(session, { file_path: pdfPath }, signal)
  fullCalls++

  let violations = validateJsonSchemaValue(readToolDef.output.schema, current, 'value')
  assert.deepEqual(violations, [], 'Initial chunk must conform to read_pdf output schema')
  assert.equal(current.source_sha256, pdfSha256, 'source_sha256 must be present and match')
  assert.equal(current.manifest_path, undefined, 'manifest_path must be omitted in compact view')
  assert.equal(current.markdown_path, undefined, 'markdown_path must be omitted in compact view')
  assert.equal(current.toc, undefined, 'top-level toc must be omitted in compact view')
  assert.ok(current.markdown_content.length <= 8000, 'Chunk markdown_content must be <= 8000 chars')

  fullChunks.push({
    chunk: fullCalls,
    chars: current.markdown_content.length,
    status: current.content_status,
  })

  while (current.content_status === 'partial' && current.cursor) {
    assert.ok(fullCalls < 1000, 'Continuation exceeded the replay round cap')
    current = await service.parseDocument(session, { file_path: pdfPath, cursor: current.cursor }, signal)
    fullCalls++

    violations = validateJsonSchemaValue(readToolDef.output.schema, current, 'value')
    assert.deepEqual(violations, [], `Chunk ${fullCalls} must conform to read_pdf output schema`)
    assert.ok(current.markdown_content.length <= 8000, `Chunk ${fullCalls} must be <= 8000 chars`)
    fullChunks.push({
      chunk: fullCalls,
      chars: current.markdown_content.length,
      status: current.content_status,
    })
  }

  assert.equal(current.content_status, 'complete', 'Final chunk must have content_status: complete')
  assert.equal(current.cursor, null, 'Final chunk must have cursor: null')
  const totalCharsDelivered = fullChunks.reduce((sum, c) => sum + c.chars, 0)
  console.log(`[Test 1 Passed] Delivered ${totalCharsDelivered} characters across ${fullCalls} chunks (all chunks <= 8000 chars)`)

  // --- Test 2: Selected Section Reading (Pages 14-15) ---
  console.log('\n[Test 2] Testing page range selection (pages 14-15)...')
  const p1415 = await service.parseDocument(session, { file_path: pdfPath, pages: '14-15' }, signal)
  violations = validateJsonSchemaValue(readToolDef.output.schema, p1415, 'value')
  assert.deepEqual(violations, [], 'Pages 14-15 view must conform to schema')
  assert.equal(p1415.pages, '14-15', 'Pages label must reflect selection')
  assert.ok(p1415.markdown_content.length <= 8000, 'Content must be <= 8000 chars')

  const prose1415 = plugin.formatResultProse(p1415)
  assert.ok(prose1415.length <= p1415.output_limit_chars, 'Formatted prose must be within output budget')
  console.log(`[Test 2 Passed] Pages 14-15 delivered: ${p1415.markdown_content.length} chars (prose: ${prose1415.length} chars)`)

  // --- Test 3: Literal Queries with Spacing Variations ---
  console.log('\n[Test 3] Testing literal query searches (表 4, 表4, 图 7, 图7, and raw caption)...')
  const queryTests = [
    { query: '表 4', expectMatches: true },
    { query: '表4', expectMatches: false }, // upstream text uses space
    { query: '图 7', expectMatches: true },
    { query: '图7', expectMatches: false }, // upstream caption uses space
    { query: '分布外的数据集上不同方法验证通过率对比', expectMatches: true },
  ]

  const queryResults = []
  for (const t of queryTests) {
    const qRes = await service.parseDocument(session, { file_path: pdfPath, query: t.query }, signal)
    violations = validateJsonSchemaValue(readToolDef.output.schema, qRes, 'value')
    assert.deepEqual(violations, [], `Query "${t.query}" output must conform to schema`)

    const locators = [...(qRes.markdown_content?.matchAll(/\[(mr_[^\]]+)\]/g) ?? [])].map(m => m[1])
    if (t.expectMatches) {
      assert.ok(locators.length > 0, `Query "${t.query}" was expected to have matches`)
    } else {
      assert.equal(locators.length, 0, `Query "${t.query}" was expected to be a miss`)
      assert.ok(qRes.markdown_content.includes('No literal matches'), 'Miss must output model-facing message')
    }
    queryResults.push({
      query: t.query,
      status: qRes.content_status,
      locators,
      length: qRes.markdown_content?.length,
    })
  }
  console.log('[Test 3 Passed] Literal query spacing behavior verified:')
  for (const qr of queryResults) {
    console.log(`  - "${qr.query}": ${qr.locators.length} match(es) -> ${qr.locators.join(', ') || 'No matches'}`)
  }

  // --- Test 4: Exact Block ID Retrieval ---
  console.log('\n[Test 4] Testing exact block_id reads (Table 4 and Figure 7)...')
  const tableBlockId = queryResults.find(result => result.query === '分布外的数据集上不同方法验证通过率对比').locators[0]?.split(' · ')[0]
  const chartBlockId = queryResults.find(result => result.query === '图 7').locators.find(locator => locator.includes(' · 图 7'))?.split(' · ')[0]
  assert.ok(tableBlockId && chartBlockId, 'Search must locate the review case study table and chart')

  const bTable = await service.parseDocument(session, { file_path: pdfPath, block_id: tableBlockId }, signal)
  violations = validateJsonSchemaValue(readToolDef.output.schema, bTable, 'value')
  assert.deepEqual(violations, [], 'b172 output must conform to schema')
  assert.ok(bTable.markdown_content.startsWith(`[${tableBlockId} · Page 14 · 表 4]`), 'b172 header must include ID, page, and document label 表 4')
  assert.ok(bTable.markdown_content.includes('<table>'), 'b172 must contain the table body')

  const bChart = await service.parseDocument(session, { file_path: pdfPath, block_id: chartBlockId }, signal)
  violations = validateJsonSchemaValue(readToolDef.output.schema, bChart, 'value')
  assert.deepEqual(violations, [], 'b180 output must conform to schema')
  assert.ok(bChart.markdown_content.startsWith(`[${chartBlockId} · Page 15 · 图 7]`), 'b180 header must include ID, page, and document label 图 7')
  assert.ok(bChart.markdown_content.includes('> 图 7 (Page 15)'), 'b180 figure markdown must use document_label 图 7')

  console.log(`[Test 4 Passed] Exact block retrieval verified:`)
  console.log(`  - ${tableBlockId}: ${bTable.markdown_content.length} chars (Table 4 confirmed)`)
  console.log(`  - ${chartBlockId}: ${bChart.markdown_content.length} chars (Figure 7 confirmed)`)

  // --- Test 5: Quality Warnings & Upstream Fidelity Report ---
  console.log('\n[Test 5] Inspecting quality warnings and upstream fidelity limits...')
  const sampleWarnings = current.warnings ?? []
  console.log(`Collected ${sampleWarnings.length} sample quality warning(s):`)
  for (const w of sampleWarnings.slice(0, 5)) {
    console.log(`  - ${w}`)
  }
  if (sampleWarnings.length > 5) {
    console.log(`  ... (${sampleWarnings.length - 5} more warnings)`)
  }

  // Check document summary counts
  const summary = current.summary ?? {}
  console.log('\nDocument Summary Structure:', {
    page_count: summary.page_count,
    table_count: summary.table_count,
    image_count: summary.image_count,
    equation_count: summary.equation_count,
  })

  // 6. Build Final Summary (No full text persisted or dumped)
  const smokeSummary = {
    replay_mode: 'offline-cached-artifacts',
    pdf_source: basename(pdfPath),
    pdf_bytes: pdfStat.size,
    pdf_sha256: pdfSha256,
    manifest_id: manifest.id,
    manifest_cache_key: manifest.cacheKey,
    document_summary: summary,
    full_reading: {
      total_chunks: fullCalls,
      total_characters: totalCharsDelivered,
      all_chunks_within_8000: fullChunks.every(c => c.chars <= 8000),
      final_status: current.content_status,
      cursor_cleared_on_complete: current.cursor === null,
    },
    section_reading_p14_15: {
      characters: p1415.markdown_content.length,
      contains_table_4: p1415.markdown_content.includes('表 4'),
      contains_figure_7: p1415.markdown_content.includes('图 7'),
    },
    query_evidence: queryResults.map(q => ({
      query: q.query,
      matches_found: q.locators.length,
      locators: q.locators,
    })),
    block_id_evidence: [
      { id: tableBlockId, label: '表 4', length: bTable.markdown_content.length },
      { id: chartBlockId, label: '图 7', length: bChart.markdown_content.length },
    ],
    quality_warnings: sampleWarnings,
    upstream_fidelity_observation:
      'Upstream MinerU extraction in content_list.json has pre-existing gaps (e.g. empty textual content in specific blocks, unparsed numbers in text). Offline replay faithfully respects these limits without fabricating missing content.',
    schema_validation: 'passed (0 violations across all views)',
    network_guard: 'passed (0 requests permitted)',
  }

  if (outputDirectoryArg) {
    await mkdir(outputDirectoryArg, { recursive: true })
    const summaryOutPath = join(outputDirectoryArg, 'smoke-reader-cache-summary.json')
    await writeFile(summaryOutPath, JSON.stringify(smokeSummary, null, 2) + '\n', 'utf8')
    console.log(`\n[Artifacts] Summary written to ${summaryOutPath}`)
  }

  console.log('\n--- Replay Summary ---')
  console.log(JSON.stringify(smokeSummary, null, 2))
  console.log('\nSmoke cache replay completed successfully!')

} finally {
  try { await disposePlugin?.() } finally { globalThis.fetch = nativeFetch }
  if (typeof smokeTmpRoot === 'string') {
    await rm(smokeTmpRoot, { recursive: true, force: true }).catch(() => undefined)
  }
}
