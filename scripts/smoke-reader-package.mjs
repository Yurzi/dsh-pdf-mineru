#!/usr/bin/env node
/**
 * Validate an already built, packed, extracted, and production-installed artifact.
 * The release operator owns pnpm build/pack/install; this script performs no build,
 * install, or cleanup of those inputs.
 *
 * Usage:
 *   node scripts/smoke-reader-package.mjs <installed-package-directory> <pdf>
 *     [page=1] [.vitest-cache/package-smoke]
 *     [--backend=auto|pdfjs] [--expect-renderer=poppler|pdfjs]
 *
 * Recommended release flow (run by the main agent/operator): build; pnpm pack; extract
 * the tarball into an isolated project; install production + peer dependencies there;
 * then pass that installed package directory here. Integration is intentionally pending
 * until those external build/pack/install steps have completed.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rawArgs = process.argv.slice(2).filter(arg => arg !== '--')
const positional = []
let backend = 'pdfjs'
let expectedRenderer
for (const arg of rawArgs) {
  if (arg.startsWith('--backend=')) backend = arg.slice('--backend='.length)
  else if (arg.startsWith('--expect-renderer=')) expectedRenderer = arg.slice('--expect-renderer='.length)
  else if (arg.startsWith('--')) {
    console.error('Unknown option: ' + arg)
    process.exitCode = 1
  } else positional.push(arg)
}

const packageDirectory = positional[0] === undefined ? undefined : resolve(positional[0])
const pdf = positional[1] === undefined ? undefined : resolve(positional[1])
const page = Number(positional[2] ?? 1)
const outputDirectory = positional[3] === undefined ? undefined : resolve(positional[3])
const validRenderer = value => value === 'poppler' || value === 'pdfjs'
if (!packageDirectory || !pdf || !Number.isSafeInteger(page) || page < 1 || positional.length > 4
  || !['auto', 'pdfjs'].includes(backend)
  || (expectedRenderer !== undefined && !validRenderer(expectedRenderer))
  || process.exitCode) {
  console.error('Usage: node scripts/smoke-reader-package.mjs <installed-package-directory> <pdf> [page=1] [.vitest-cache/package-smoke] [--backend=auto|pdfjs] [--expect-renderer=poppler|pdfjs]')
  process.exitCode = 1
} else {
  const assertRegularFile = async (path, label) => {
    const details = await stat(path)
    assert.ok(details.isFile(), label + ' must be a regular file')
    assert.ok(details.size > 0, label + ' must not be empty')
  }
  const assertDirectory = async (path, label) => {
    assert.ok((await stat(path)).isDirectory(), label + ' must be a directory')
  }

  const manifestPath = join(packageDirectory, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.equal(manifest.name, 'dsh-pdf-mineru')
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.main, './lib/index.js', 'packed manifest must expose the production entry')
  assert.equal(manifest.exports?.['.']?.default, './lib/index.js')
  assert.equal(typeof manifest.dependencies?.['pdfjs-dist'], 'string', 'pdfjs-dist must be a production dependency')
  assert.equal(typeof manifest.dependencies?.['@napi-rs/canvas'], 'string', '@napi-rs/canvas must be a production dependency')

  const entryPath = join(packageDirectory, manifest.main)
  const workerPath = join(packageDirectory, 'lib', 'pdfjs-worker.mjs')
  await assertRegularFile(entryPath, 'packed plugin entry')
  await assertRegularFile(workerPath, 'packed PDF.js worker')

  // Resolve from the installed artifact, not this checkout's node_modules.
  const packageRequire = createRequire(manifestPath)
  const pdfjsManifest = packageRequire.resolve('pdfjs-dist/package.json')
  const canvasEntry = packageRequire.resolve('@napi-rs/canvas')
  const pdfjsRoot = dirname(pdfjsManifest)
  await assertRegularFile(pdfjsManifest, 'installed pdfjs-dist manifest')
  await assertRegularFile(canvasEntry, 'installed @napi-rs/canvas entry')
  await assertDirectory(join(pdfjsRoot, 'cmaps'), 'installed pdfjs-dist cmaps')
  await assertDirectory(join(pdfjsRoot, 'iccs'), 'installed pdfjs-dist ICC profiles')
  await assertDirectory(join(pdfjsRoot, 'standard_fonts'), 'installed pdfjs-dist standard fonts')
  await assertDirectory(join(pdfjsRoot, 'wasm'), 'installed pdfjs-dist wasm resources')
  const pdfjsMain = await packageRequire.resolve('pdfjs-dist/legacy/build/pdf.mjs')
  await assertRegularFile(pdfjsMain, 'installed PDF.js legacy build')
  let pdfjsWorker
  try {
    pdfjsWorker = packageRequire.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
  } catch {
    pdfjsWorker = packageRequire.resolve('pdfjs-dist/build/pdf.worker.mjs')
  }
  await assertRegularFile(pdfjsWorker, 'installed PDF.js runtime worker')

  const foreignCwd = await mkdtemp(join(tmpdir(), 'mineru-packed-smoke-cwd-'))
  const smokeScript = fileURLToPath(new URL('./smoke-reader-local.mjs', import.meta.url))
  const childArgs = [
    smokeScript, pdf, String(page),
    ...(outputDirectory === undefined ? [] : [outputDirectory]),
    '--plugin=' + packageDirectory,
    '--backend=' + backend,
    ...(expectedRenderer === undefined ? [] : ['--expect-renderer=' + expectedRenderer]),
  ]
  try {
    const status = await new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(process.execPath, childArgs, {
        cwd: foreignCwd,
        env: { ...process.env, DSH_PDF_MINERU_PACKAGE_SMOKE: '1' },
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      let stdout = ''
      let stderr = ''
      const append = (current, chunk) => {
        const next = current + String(chunk)
        assert.ok(Buffer.byteLength(next) <= 256 * 1024, 'package smoke child output exceeded limit')
        return next
      }
      child.stdout.on('data', chunk => { stdout = append(stdout, chunk) })
      child.stderr.on('data', chunk => { stderr = append(stderr, chunk) })
      child.once('error', rejectPromise)
      child.once('close', (code, signal) => resolvePromise({ code, signal, stdout, stderr }))
    })
    if (status.stdout) process.stdout.write(status.stdout)
    if (status.stderr) process.stderr.write(status.stderr)
    assert.equal(status.signal, null, 'package smoke child must not be terminated by a signal')
    assert.equal(status.code, 0, 'package smoke child must succeed')
    console.log(JSON.stringify({
      package: manifest.name, version: manifest.version, entry: manifest.main,
      bundled_worker: 'lib/pdfjs-worker.mjs', production_dependencies: ['pdfjs-dist', '@napi-rs/canvas'],
      backend, foreign_cwd: 'passed', full_plugin_tool_chain: 'passed',
    }, null, 2))
  } finally {
    await rm(foreignCwd, { recursive: true, force: true })
  }
}
