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
import { createHash } from 'node:crypto'
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

function locatorIds(markdown) {
  return [...(markdown?.matchAll(/\[(mr_[^\]]+)\]/g) ?? [])].map(match => match[1].split(' · ')[0])
}

function decodeCursorPayload(cursor) {
  assert.ok(typeof cursor === 'string' && cursor.length <= 2048, 'Continuation cursor must be a bounded string')
  const payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  assert.equal(payload.v, 3, 'Offline replay must exercise cursor-v3')
  return payload
}

function assertMetadataContract(view, label, shortenedFields) {
  const allowed = new Set(['summary', 'provenance', 'diagnostics', 'verification_hints', 'warnings'])
  for (const field of view.metadata_shortened ?? []) {
    assert.ok(allowed.has(field), `${label} reported an unknown metadata_shortened field: ${field}`)
    shortenedFields.add(field)
  }
  assert.equal(new Set(view.metadata_shortened ?? []).size, (view.metadata_shortened ?? []).length, `${label} metadata_shortened must not contain duplicates`)
  for (const diagnostic of view.diagnostics ?? []) {
    assert.ok(['document', 'selection', 'chunk'].includes(diagnostic.scope), `${label} diagnostic scope must be structured`)
    assert.ok(typeof diagnostic.id === 'string' && diagnostic.id.length > 0, `${label} diagnostic must have an ID`)
  }
}

try {
  console.log('--- MinerU Offline Cache Replay Smoke ---')
  console.log('Mode: Offline replay from pre-existing cached artifacts (NOT fresh Provider extraction)')

  // 1. Stat & Hash PDF source
  const pdfStat = await stat(pdfPath)
  assert.ok(pdfStat.isFile(), 'PDF path must be a regular file')
  const pdfSha256 = await hashFile(pdfPath, 200 * 1024 * 1024)
  assert.equal(pdfSha256, 'c0a12f8f350b13dd16e840821693835cf0473a426fd3052bf3dc301868733082', 'Replay expects the known rx033 review PDF')

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

  const contentListArtifact = document.artifacts.find(artifact => artifact.kind === 'content-list')
  assert.ok(contentListArtifact && contentListArtifact.bytes <= 8 * 1024 * 1024, 'A bounded content-list artifact is required')
  const contentListPath = join(manifestDir, contentListArtifact.relativePath)
  const rawContentBlocks = JSON.parse(await readFile(contentListPath, 'utf8'))
  assert.ok(Array.isArray(rawContentBlocks), 'content-list root must be an array')

  const rawEquation7 = rawContentBlocks.find(block =>
    block?.type === 'equation' && typeof block.text === 'string' && block.text.includes('\\tag{7}'))
  assert.ok(rawEquation7 && rawEquation7.page_idx === 6, 'Known equation (7) must exist on physical page 7')

  const referenceItems = rawContentBlocks.flatMap(block => {
    if (block?.type === 'list' && block.sub_type === 'ref_text' && Array.isArray(block.list_items)) {
      return block.list_items.filter(item => typeof item === 'string')
    }
    return block?.type === 'ref_text' && typeof block.text === 'string' ? [block.text] : []
  })
  assert.equal(referenceItems.length, 41, 'Known review paper must expose all 41 reference entries')
  for (let index = 1; index <= 41; index++) {
    assert.ok(referenceItems.some(item => item.startsWith(`[${index}]`)), `Reference [${index}] must be present in source evidence`)
  }

  if (manifest.producer.providerId === 'official-v4') {
    assert.equal(manifest.request.semantics.model, 'pipeline', 'Official replay must use the pipeline cache')
    const officialFirstReferenceIndex = rawContentBlocks.findIndex(block => block?.type === 'list' && block.sub_type === 'ref_text')
    const officialFirstReference = rawContentBlocks[officialFirstReferenceIndex]
    assert.equal(officialFirstReferenceIndex + 1, 202, 'Official pipeline first reference list must remain source block 202')
    assert.equal(officialFirstReference.list_items.length, 15, 'Official block 202 must contain references [1]-[15]')
    for (let index = 1; index <= 15; index++) {
      assert.ok(officialFirstReference.list_items[index - 1].startsWith(`[${index}]`), `Official block 202 reference ${index} must retain its label`)
    }
  } else {
    assert.equal(manifest.producer.providerId, 'self-hosted-v2', 'Replay supports the known self-hosted-v2 and official-v4 caches')
    assert.equal(manifest.request.semantics.model, 'vlm', 'Self-hosted replay must use the VLM cache')
  }

  console.log(`[Integrity] Source PDF verified (${pdfStat.size} bytes, sha256: ${pdfSha256.slice(0, 16)}...)`)
  console.log(`[Integrity] Manifest verified (result_id: ${manifest.id}, ${verifiedArtifactsCount} artifacts, ${totalArtifactBytes} bytes total)`)
  console.log(`[Cache] ${manifest.producer.providerId}/${manifest.request.semantics.model}, ${rawContentBlocks.length} source blocks, ${referenceItems.length} references`)

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
          configure() { return noop },
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
  const shortenedFields = new Set()
  const expectedProvenance = {
    provider: manifest.producer.providerId,
    model: manifest.request.semantics.model,
    parse_method: manifest.request.semantics.parseMethod,
    upstream_version: null,
    index_version: 2,
    reader_version: 3,
  }
  let fullCalls = 0
  let current = await service.parseDocument(session, { file_path: pdfPath, inline_images: false }, signal)
  fullCalls++

  let violations = validateJsonSchemaValue(readToolDef.output.schema, current, 'value')
  assert.deepEqual(violations, [], 'Initial chunk must conform to read_pdf output schema')
  assert.equal(current.source_sha256, pdfSha256, 'source_sha256 must be present and match')
  assert.equal(current.manifest_path, undefined, 'manifest_path must be omitted in compact view')
  assert.equal(current.markdown_path, undefined, 'markdown_path must be omitted in compact view')
  assert.equal(current.toc, undefined, 'top-level toc must be omitted in compact view')
  assert.ok(current.markdown_content.length <= 8000, 'Chunk markdown_content must be <= 8000 chars')
  assert.deepEqual(current.provenance, expectedProvenance, 'Provenance must reflect the actual cached parser and current reader')
  assertMetadataContract(current, 'initial full chunk', shortenedFields)
  const documentSummary = current.summary ?? {}
  if (current.cursor) assert.equal(decodeCursorPayload(current.cursor).inline_images, false, 'First cursor must encode explicit image-off intent')

  fullChunks.push({
    chunk: fullCalls,
    chars: current.markdown_content.length,
    status: current.content_status,
    diagnostics: current.diagnostics?.length ?? 0,
  })

  while (current.content_status === 'partial' && current.cursor) {
    assert.ok(fullCalls < 1000, 'Continuation exceeded the replay round cap')
    assert.equal(decodeCursorPayload(current.cursor).inline_images, false, `Cursor ${fullCalls} must preserve image-off intent`)
    current = await service.parseDocument(session, { file_path: pdfPath, cursor: current.cursor }, signal)
    fullCalls++

    violations = validateJsonSchemaValue(readToolDef.output.schema, current, 'value')
    assert.deepEqual(violations, [], `Chunk ${fullCalls} must conform to read_pdf output schema`)
    assert.ok(current.markdown_content.length <= 8000, `Chunk ${fullCalls} must be <= 8000 chars`)
    assertMetadataContract(current, `full chunk ${fullCalls}`, shortenedFields)
    if (current.cursor) assert.equal(decodeCursorPayload(current.cursor).inline_images, false, `Cursor ${fullCalls} must retain inherited image-off intent`)
    fullChunks.push({
      chunk: fullCalls,
      chars: current.markdown_content.length,
      status: current.content_status,
      diagnostics: current.diagnostics?.length ?? 0,
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

  // --- Test 5: Raw Formula Fidelity & Inline-Slot Diagnostics ---
  console.log('\n[Test 5] Testing raw equation fidelity, formula hints, and inline-slot diagnostics...')
  const equationQuery = await service.parseDocument(session, { file_path: pdfPath, query: '\\tag{7}' }, signal)
  violations = validateJsonSchemaValue(readToolDef.output.schema, equationQuery, 'value')
  assert.deepEqual(violations, [], 'Equation query must conform to schema')
  const equationBlockId = locatorIds(equationQuery.markdown_content)[0]
  assert.ok(equationBlockId, 'Equation (7) query must derive a block ID')
  const equationBlock = await service.parseDocument(session, { file_path: pdfPath, block_id: equationBlockId }, signal)
  violations = validateJsonSchemaValue(readToolDef.output.schema, equationBlock, 'value')
  assert.deepEqual(violations, [], 'Equation block must conform to schema')
  assert.equal(equationBlock.markdown_content.slice(equationBlock.markdown_content.indexOf('\n\n') + 2), rawEquation7.text.trim(),
    'Equation (7) must preserve the selected cache raw text exactly, without auto-repair')
  assert.deepEqual(equationBlock.verification_hints, [{ reason: 'formula', block_id: equationBlockId, page: 7, view: 'page' }],
    'Equation (7) must carry an advisory original-page verification hint')

  const rawSlotIndex = rawContentBlocks.findIndex(block => typeof block?.text === 'string' && block.text.includes('其中， 表示可训练参数'))
  assert.ok(rawSlotIndex >= 0, 'Known inline-slot source evidence must exist')
  const slotQuery = await service.parseDocument(session, { file_path: pdfPath, query: '其中， 表示可训练参数' }, signal)
  violations = validateJsonSchemaValue(readToolDef.output.schema, slotQuery, 'value')
  assert.deepEqual(violations, [], 'Inline-slot query must conform to schema')
  const slotBlockId = locatorIds(slotQuery.markdown_content)[0]
  assert.equal(slotBlockId, `${manifest.id}:b${rawSlotIndex + 1}`, 'Inline-slot query must derive the stable source block ID')
  assert.ok(slotQuery.markdown_content.includes('其中， 表示可训练参数'), 'Known raw gap must remain unmodified')
  const slotDiagnostic = (slotQuery.diagnostics ?? []).find(item => item.code === 'DOCUMENT_INDEX_POSSIBLE_TEXT_GAP')
  assert.deepEqual(slotDiagnostic && { scope: slotDiagnostic.scope, block_id: slotDiagnostic.block_id, page: slotDiagnostic.page },
    { scope: 'chunk', block_id: slotBlockId, page: rawContentBlocks[rawSlotIndex].page_idx + 1 },
    'Inline-slot evidence must use a delivered-block structured diagnostic')
  assert.ok(!(slotQuery.warnings ?? []).some(item => item.includes('DOCUMENT_INDEX_')), 'Block diagnostics must not use legacy warnings')
  console.log(`[Test 5 Passed] ${equationBlockId} raw formula preserved; ${slotBlockId} carries chunk-scoped diagnostics`)

  // --- Test 6: Complete Reference Delivery & Query-Derived IDs ---
  console.log('\n[Test 6] Testing complete references and later-entry searches...')
  async function collectSelection(initialInput, label) {
    const chunks = []
    let view = await service.parseDocument(session, initialInput, signal)
    let calls = 1
    for (;;) {
      violations = validateJsonSchemaValue(readToolDef.output.schema, view, 'value')
      assert.deepEqual(violations, [], `${label} chunk ${calls} must conform to schema`)
      assertMetadataContract(view, `${label} chunk ${calls}`, shortenedFields)
      chunks.push(view.markdown_content ?? '')
      if (view.content_status !== 'partial' || !view.cursor) break
      assert.ok(calls < 100, `${label} exceeded continuation cap`)
      view = await service.parseDocument(session, { file_path: pdfPath, cursor: view.cursor }, signal)
      calls++
    }
    assert.equal(view.content_status, 'complete', `${label} must finish completely`)
    assert.equal(view.cursor, null, `${label} final cursor must clear`)
    return { text: chunks.join(''), calls }
  }

  const references = await collectSelection({ file_path: pdfPath, pages: '17-19', focus: 'text' }, 'references')
  for (let index = 1; index <= 41; index++) {
    assert.ok(references.text.includes(`[${index}]`), `Delivered references must include [${index}]`)
  }
  for (const reference of referenceItems) assert.ok(references.text.includes(reference.trim()), 'Every reference must retain its full authored text, not merely its numeric label')

  const firstReferenceQuery = await service.parseDocument(session, { file_path: pdfPath, query: 'Software testing research: Achievements, challenges, dreams' }, signal)
  const firstReferenceBlockId = locatorIds(firstReferenceQuery.markdown_content)[0]
  assert.ok(firstReferenceBlockId, 'First-reference query must derive a block ID')
  const firstReferenceBlock = await service.parseDocument(session, { file_path: pdfPath, block_id: firstReferenceBlockId }, signal)
  for (const [label, view] of [['first-reference query', firstReferenceQuery], ['first-reference block', firstReferenceBlock]]) {
    violations = validateJsonSchemaValue(readToolDef.output.schema, view, 'value')
    assert.deepEqual(violations, [], `${label} must conform to schema`)
  }
  if (manifest.producer.providerId === 'official-v4') {
    assert.equal(firstReferenceBlockId, `${manifest.id}:b202`, 'Official first-reference query must resolve source block 202')
    for (let index = 1; index <= 15; index++) {
      assert.ok(firstReferenceBlock.markdown_content.includes(`[${index}]`), `Official block 202 must deliver reference [${index}]`)
    }
  } else {
    assert.ok(firstReferenceBlock.markdown_content.includes(referenceItems[0]), 'Self-hosted reference evidence must be located dynamically')
  }

  const laterReferenceEvidence = []
  for (const evidence of [
    { query: 'Enchanting program specification synthesis by large language models', label: '[28]' },
    { query: 'Reducing the costs of proof synthesis', label: '[41]' },
  ]) {
    const queryView = await service.parseDocument(session, { file_path: pdfPath, query: evidence.query }, signal)
    const blockId = locatorIds(queryView.markdown_content)[0]
    assert.ok(blockId, `Later reference ${evidence.label} query must derive a block ID`)
    const block = await service.parseDocument(session, { file_path: pdfPath, block_id: blockId }, signal)
    for (const [label, view] of [[`${evidence.label} query`, queryView], [`${evidence.label} block`, block]]) {
      violations = validateJsonSchemaValue(readToolDef.output.schema, view, 'value')
      assert.deepEqual(violations, [], `${label} must conform to schema`)
    }
    assert.ok(block.markdown_content.includes(evidence.label), `Later reference block must contain ${evidence.label}`)
    laterReferenceEvidence.push({ label: evidence.label, id: blockId })
  }
  console.log(`[Test 6 Passed] ${referenceItems.length} references delivered in ${references.calls} chunk(s); later IDs derived by query`)

  // --- Test 7: Diagnostic Scope & Selection Isolation ---
  console.log('\n[Test 7] Testing TOC/table isolation and one-time scope diagnostics...')
  const tocOnly = await service.parseDocument(session, { file_path: pdfPath, focus: 'toc' }, signal)
  violations = validateJsonSchemaValue(readToolDef.output.schema, tocOnly, 'value')
  assert.deepEqual(violations, [], 'TOC-only view must conform to schema')
  assert.equal((tocOnly.diagnostics ?? []).length, 0, 'TOC-only view must exclude unrelated block diagnostics')
  assert.ok((bTable.diagnostics ?? []).every(item => item.block_id === tableBlockId), 'Table block must exclude unrelated diagnostics')

  assert.ok(Number.isSafeInteger(documentSummary.page_count), 'Known review paper must report a physical page count')
  assert.ok(documentSummary.page_count >= 19, 'Known reference section requires pages 17-19')
  const scopedPages = `1-${documentSummary.page_count + 1}`
  let scoped = await service.parseDocument(session, { file_path: pdfPath, pages: scopedPages, focus: ['table', 'toc', 'image'] }, signal)
  let scopedChunks = 1
  violations = validateJsonSchemaValue(readToolDef.output.schema, scoped, 'value')
  assert.deepEqual(violations, [], 'First scoped-diagnostic chunk must conform to schema')
  assert.ok((scoped.diagnostics ?? []).some(item => item.scope === 'selection'), 'First narrowed-range table chunk must include its selection diagnostic')
  while (scoped.content_status === 'partial' && scoped.cursor) {
    scoped = await service.parseDocument(session, { file_path: pdfPath, cursor: scoped.cursor }, signal)
    scopedChunks++
    violations = validateJsonSchemaValue(readToolDef.output.schema, scoped, 'value')
    assert.deepEqual(violations, [], `Scoped-diagnostic chunk ${scopedChunks} must conform to schema`)
    assert.ok((scoped.diagnostics ?? []).every(item => item.scope === 'chunk'), 'Scope-level diagnostics must not repeat after the first chunk')
    assert.ok(scopedChunks < 100, 'Scoped diagnostic continuation exceeded cap')
  }
  assert.ok(scopedChunks > 1, 'Scoped diagnostic replay must exercise at least one continuation')
  console.log(`[Test 7 Passed] TOC/table isolated; selection diagnostic emitted once across ${scopedChunks} chunks`)

  console.log('\nDocument Summary Structure:', {
    page_count: documentSummary.page_count,
    table_count: documentSummary.table_count,
    image_count: documentSummary.image_count,
    equation_count: documentSummary.equation_count,
  })

  // 8. Build Final Summary (No full text persisted or dumped)
  const smokeSummary = {
    replay_mode: 'offline-cached-artifacts',
    cache_variant: {
      provider: manifest.producer.providerId,
      model: manifest.request.semantics.model,
      parse_method: manifest.request.semantics.parseMethod,
    },
    pdf_source: basename(pdfPath),
    sizes: {
      pdf_bytes: pdfStat.size,
      manifest_bytes: manifestStat.size,
      artifact_count: verifiedArtifactsCount,
      artifact_bytes: totalArtifactBytes,
      content_list_bytes: contentListArtifact.bytes,
    },
    pdf_sha256: pdfSha256,
    manifest_id: manifest.id,
    manifest_cache_key: manifest.cacheKey,
    provenance: expectedProvenance,
    document_summary: documentSummary,
    full_reading: {
      total_chunks: fullCalls,
      total_characters: totalCharsDelivered,
      all_chunks_within_8000: fullChunks.every(c => c.chars <= 8000),
      final_status: current.content_status,
      cursor_cleared_on_complete: current.cursor === null,
      inherited_inline_images: false,
    },
    section_reading_p14_15: {
      characters: p1415.markdown_content.length,
      contains_table_4: p1415.markdown_content.includes('表 4'),
      contains_figure_7: p1415.markdown_content.includes('图 7'),
    },
    references: {
      count: referenceItems.length,
      full_delivery_chunks: references.calls,
      first_block_id: firstReferenceBlockId,
      later_entries: laterReferenceEvidence,
    },
    formula_7: {
      block_id: equationBlockId,
      page: 7,
      raw_preserved_exactly: true,
      verification_hint: 'page',
    },
    diagnostic_scope: {
      inline_slot_block_id: slotBlockId,
      inline_slot_scope: slotDiagnostic.scope,
      toc_excludes_unrelated: true,
      table_excludes_unrelated: true,
      scope_level_first_chunk_only: true,
      metadata_shortened_seen: [...shortenedFields],
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
    upstream_fidelity_observation:
      'Replay preserves provider-extracted evidence, including observed gaps and formula text, without guessing repairs. This smoke does not claim OCR or formula correctness; original-page verification remains advisory.',
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
