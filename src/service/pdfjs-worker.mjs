import dgram from 'node:dgram'
import { constants, writeSync } from 'node:fs'
import { access, open, stat } from 'node:fs/promises'
import http from 'node:http'
import http2 from 'node:http2'
import https from 'node:https'
import { createRequire } from 'node:module'
import net from 'node:net'
import { dirname, join, sep } from 'node:path'
import tls from 'node:tls'

const EXIT_UNAVAILABLE = 20
const EXIT_INVALID_PDF = 21
const EXIT_RESOURCE_LIMIT = 22
const EXIT_FAILURE = 23

const MAX_PAGE_COUNT = 1_000_000
const MAX_RAW_PAGE_EDGE_POINTS = 1_000_000
const MAX_RENDER_EDGE_PIXELS = 1600
const MAX_CANVAS_PIXELS = 1600 * 2000
const MAX_TOTAL_CANVAS_PIXELS = MAX_CANVAS_PIXELS * 4
const MAX_PNG_BYTES = 8 * 1024 * 1024
const MAX_SNAPSHOT_BYTES = 200 * 1024 * 1024
const MAX_PACKAGE_RESOURCE_BYTES = 16 * 1024 * 1024
const PDFJS_VERSION = '6.3.289'

// @napi-rs/canvas loads system fonts as an import side effect unless this is set.
process.env.DISABLE_SYSTEM_FONTS_LOAD = '1'

function denyNetwork() {
  throw new Error('Network access is disabled in the PDF.js worker')
}

// The renderer receives bytes, never a URL. Keep a second line of defence in
// case a dependency or malformed document attempts any outbound connection.
for (const [module, methods] of [
  [http, ['get', 'request']],
  [https, ['get', 'request']],
  [http2, ['connect']],
  [net, ['connect', 'createConnection']],
  [tls, ['connect']],
  [dgram, ['createSocket']],
]) {
  for (const method of methods) {
    try { module[method] = denyNetwork } catch {}
  }
}
try { globalThis.fetch = async () => denyNetwork() } catch {}
try { globalThis.WebSocket = class DisabledWebSocket { constructor() { denyNetwork() } } } catch {}

// PDF.js diagnostics can otherwise corrupt stdout's one-JSON protocol or reveal
// private paths on stderr. Failures are communicated only through exit status.
let imageLimitObserved = false
for (const method of ['debug', 'error', 'info', 'log', 'warn']) {
  try {
    console[method] = method === 'warn'
      ? message => {
          if (typeof message === 'string' && message.includes('Image exceeded maximum allowed size')) {
            imageLimitObserved = true
          }
        }
      : () => {}
  } catch {}
}

class WorkerFailure extends Error {
  constructor(exitCode) {
    super('PDF.js worker failure')
    this.exitCode = exitCode
  }
}

class ResourceLimitError extends WorkerFailure {
  constructor() {
    super(EXIT_RESOURCE_LIMIT)
    this.name = 'PdfjsResourceLimit'
  }
}

function fail(exitCode) {
  throw new WorkerFailure(exitCode)
}

function parsePositiveInteger(text, maximum = Number.MAX_SAFE_INTEGER) {
  if (!/^[1-9][0-9]*$/.test(text)) fail(EXIT_INVALID_PDF)
  const value = Number(text)
  if (!Number.isSafeInteger(value) || value > maximum) fail(EXIT_INVALID_PDF)
  return value
}

function parseArguments() {
  const args = process.argv.slice(2)
  if (args.length !== 4 || args[0].length === 0 || args[1].length === 0
    || args[0].includes('\0') || args[1].includes('\0')) {
    fail(EXIT_INVALID_PDF)
  }
  return {
    snapshotPath: args[0],
    outputPath: args[1],
    pageNumber: parsePositiveInteger(args[2], MAX_PAGE_COUNT),
    maxFileBytes: parsePositiveInteger(args[3]),
  }
}

async function assertDirectory(path) {
  const info = await stat(path)
  if (!info.isDirectory()) throw new Error('resource unavailable')
}

async function loadDependencies() {
  try {
    const require = createRequire(import.meta.url)
    const packageRoot = dirname(require.resolve('pdfjs-dist/package.json'))
    const resources = {
      cMapUrl: join(packageRoot, 'cmaps') + sep,
      iccUrl: join(packageRoot, 'iccs') + sep,
      standardFontDataUrl: join(packageRoot, 'standard_fonts') + sep,
      wasmUrl: join(packageRoot, 'wasm') + sep,
    }

    await Promise.all(Object.values(resources).map(assertDirectory))
    await Promise.all([
      access(join(resources.cMapUrl, 'Adobe-CNS1-UCS2.bcmap'), constants.R_OK),
      access(join(resources.iccUrl, 'CGATS001Compat-v2-micro.icc'), constants.R_OK),
      access(join(resources.standardFontDataUrl, 'LiberationSans-Regular.ttf'), constants.R_OK),
      access(join(resources.wasmUrl, 'jbig2.wasm'), constants.R_OK),
      access(join(resources.wasmUrl, 'openjpeg.wasm'), constants.R_OK),
      access(join(resources.wasmUrl, 'qcms_bg.wasm'), constants.R_OK),
      access(join(packageRoot, 'legacy', 'build', 'pdf.worker.mjs'), constants.R_OK),
    ])

    const [canvasModule, pdfjs] = await Promise.all([
      import('@napi-rs/canvas'),
      import('pdfjs-dist/legacy/build/pdf.mjs'),
    ])
    if (pdfjs.version !== PDFJS_VERSION || typeof pdfjs.getDocument !== 'function'
      || typeof canvasModule.createCanvas !== 'function'
      || typeof pdfjs.AnnotationMode?.ENABLE !== 'number') {
      throw new Error('incompatible rendering dependency')
    }

    return {
      createCanvas: canvasModule.createCanvas,
      pdfjs,
      resourceUrls: resources,
    }
  } catch {
    fail(EXIT_UNAVAILABLE)
  }
}

function checkedCanvasDimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width < 1 || height < 1 || width > MAX_RENDER_EDGE_PIXELS
    || height > MAX_RENDER_EDGE_PIXELS || width * height > MAX_CANVAS_PIXELS) {
    throw new ResourceLimitError()
  }
  return width * height
}

function makeCanvasFactory(createCanvas) {
  return class BoundedCanvasFactory {
    constructor() {
      this.allocations = new Map()
      this.totalPixels = 0
    }

    create(width, height) {
      const pixels = checkedCanvasDimensions(width, height)
      if (this.totalPixels + pixels > MAX_TOTAL_CANVAS_PIXELS) throw new ResourceLimitError()
      const canvas = createCanvas(width, height)
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) fail(EXIT_FAILURE)
      this.allocations.set(canvas, pixels)
      this.totalPixels += pixels
      return { canvas, context }
    }

    reset(canvasAndContext, width, height) {
      if (!canvasAndContext?.canvas) fail(EXIT_FAILURE)
      const pixels = checkedCanvasDimensions(width, height)
      const previous = this.allocations.get(canvasAndContext.canvas) ?? 0
      if (this.totalPixels - previous + pixels > MAX_TOTAL_CANVAS_PIXELS) throw new ResourceLimitError()
      canvasAndContext.canvas.width = width
      canvasAndContext.canvas.height = height
      this.allocations.set(canvasAndContext.canvas, pixels)
      this.totalPixels += pixels - previous
    }

    destroy(canvasAndContext) {
      if (!canvasAndContext?.canvas) return
      const canvas = canvasAndContext.canvas
      this.totalPixels -= this.allocations.get(canvas) ?? 0
      this.allocations.delete(canvas)
      canvas.width = 0
      canvas.height = 0
      canvasAndContext.canvas = null
      canvasAndContext.context = null
    }
  }
}

async function readSnapshot(snapshotPath, maxFileBytes) {
  let handle
  let primaryFailure
  try {
    handle = await open(snapshotPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const info = await handle.stat()
    if (!info.isFile()) fail(EXIT_FAILURE)
    if (info.size > maxFileBytes || info.size > MAX_SNAPSHOT_BYTES) throw new ResourceLimitError()
    const data = await handle.readFile()
    if (data.byteLength > maxFileBytes || data.byteLength > MAX_SNAPSHOT_BYTES) throw new ResourceLimitError()
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  } catch (error) {
    primaryFailure = error
    throw error
  } finally {
    if (handle) {
      try { await handle.close() } catch (error) { if (!primaryFailure) throw error }
    }
  }
}

function validResourceFilename(kind, filename) {
  if (typeof filename !== 'string' || filename.length < 1 || filename.length > 128
    || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(filename) || filename.includes('..')) {
    return false
  }
  switch (kind) {
    case 'cMapUrl': return filename.endsWith('.bcmap')
    case 'iccUrl': return filename.endsWith('.icc')
    case 'standardFontDataUrl': return filename.endsWith('.pfb') || filename.endsWith('.ttf')
    case 'wasmUrl':
      return filename.endsWith('.wasm') || filename.endsWith('_nowasm_fallback.js')
    default: return false
  }
}

async function readPackageResource(path) {
  let handle
  let primaryFailure
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const info = await handle.stat()
    if (!info.isFile() || info.size < 1 || info.size > MAX_PACKAGE_RESOURCE_BYTES) {
      throw new Error('package resource unavailable')
    }
    const data = await handle.readFile()
    if (data.byteLength > MAX_PACKAGE_RESOURCE_BYTES) throw new Error('package resource unavailable')
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  } catch (error) {
    primaryFailure = error
    throw error
  } finally {
    if (handle) {
      try { await handle.close() } catch (error) { if (!primaryFailure) throw error }
    }
  }
}

function makeBinaryDataFactory(resourcePaths, resourceState) {
  return class BoundedBinaryDataFactory {
    async fetch({ kind, filename }) {
      if (!validResourceFilename(kind, filename)) {
        resourceState.invalidRequest = true
        throw new Error('invalid package resource request')
      }
      try {
        return await readPackageResource(join(resourcePaths[kind], filename))
      } catch {
        resourceState.unavailable = true
        throw new Error('package resource unavailable')
      }
    }
  }
}

function rawPageViewport(page) {
  if (!Array.isArray(page.view) || page.view.length !== 4
    || !page.view.every(Number.isFinite) || !Number.isFinite(page.userUnit) || page.userUnit <= 0) {
    throw new ResourceLimitError()
  }
  const rawWidth = Math.abs(page.view[2] - page.view[0]) * page.userUnit
  const rawHeight = Math.abs(page.view[3] - page.view[1]) * page.userUnit
  if (!Number.isFinite(rawWidth) || !Number.isFinite(rawHeight) || rawWidth <= 0 || rawHeight <= 0
    || rawWidth > MAX_RAW_PAGE_EDGE_POINTS || rawHeight > MAX_RAW_PAGE_EDGE_POINTS) {
    throw new ResourceLimitError()
  }

  const viewport = page.getViewport({ scale: 1 })
  if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height)
    || viewport.width <= 0 || viewport.height <= 0
    || viewport.width > MAX_RAW_PAGE_EDGE_POINTS || viewport.height > MAX_RAW_PAGE_EDGE_POINTS
    || !Array.isArray(viewport.transform) || !viewport.transform.every(Number.isFinite)) {
    throw new ResourceLimitError()
  }
  return viewport
}

function scaledViewport(page, rawViewport) {
  const rawLongEdge = Math.max(rawViewport.width, rawViewport.height)
  // A tiny margin avoids floating-point ceil producing 1601 on the target edge.
  const scale = (MAX_RENDER_EDGE_PIXELS - 1e-6) / rawLongEdge
  if (!Number.isFinite(scale) || scale <= 0) throw new ResourceLimitError()
  const viewport = page.getViewport({ scale })
  if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height)
    || !Array.isArray(viewport.transform) || !viewport.transform.every(Number.isFinite)) {
    throw new ResourceLimitError()
  }
  const width = Math.max(1, Math.ceil(viewport.width))
  const height = Math.max(1, Math.ceil(viewport.height))
  checkedCanvasDimensions(width, height)
  return { viewport, width, height }
}

function isImageLimitFailure(error) {
  const seen = new Set()
  for (let current = error; current && typeof current === 'object' && !seen.has(current); current = current.cause) {
    seen.add(current)
    if (current instanceof ResourceLimitError || current.name === 'PdfjsResourceLimit') return true
    if (typeof current.message === 'string'
      && current.message.includes('Image exceeded maximum allowed size')) return true
  }
  return false
}

async function loadDocument(pdfjs, CanvasFactory, BinaryDataFactory, resourceState, resourceUrls, data) {
  let loadingTask
  try {
    loadingTask = pdfjs.getDocument({
      data,
      cMapUrl: resourceUrls.cMapUrl,
      cMapPacked: true,
      iccUrl: resourceUrls.iccUrl,
      standardFontDataUrl: resourceUrls.standardFontDataUrl,
      wasmUrl: resourceUrls.wasmUrl,
      useWorkerFetch: false,
      useWasm: true,
      // PDF.js 6.3 turns strict operator-list failures into an empty list; its
      // permissive path emits the stable oversized-image warning that we trap.
      stopAtErrors: false,
      maxImageSize: MAX_CANVAS_PIXELS,
      canvasMaxAreaInBytes: MAX_CANVAS_PIXELS * 4,
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      enableXfa: false,
      enableHWA: false,
      pdfBug: false,
      CanvasFactory,
      BinaryDataFactory,
      // Warnings remain process-private; the controlled hook detects only the
      // stable maxImageSize signal and emits no diagnostic text.
      verbosity: pdfjs.VerbosityLevel.WARNINGS,
    })
    return { document: await loadingTask.promise, loadingTask }
  } catch {
    if (loadingTask) {
      try { await loadingTask.destroy() } catch {}
    }
    if (resourceState.unavailable) fail(EXIT_UNAVAILABLE)
    fail(EXIT_INVALID_PDF)
  }
}

async function render() {
  const { snapshotPath, outputPath, pageNumber, maxFileBytes } = parseArguments()
  const { createCanvas, pdfjs, resourceUrls } = await loadDependencies()
  const data = await readSnapshot(snapshotPath, maxFileBytes)
  const CanvasFactory = makeCanvasFactory(createCanvas)
  const resourceState = { unavailable: false, invalidRequest: false }
  const BinaryDataFactory = makeBinaryDataFactory(resourceUrls, resourceState)
  const loaded = await loadDocument(
    pdfjs, CanvasFactory, BinaryDataFactory, resourceState, resourceUrls, data,
  )
  const document = loaded.document
  let primaryFailure
  let pageCount
  try {
    pageCount = document.numPages
    if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > MAX_PAGE_COUNT
      || pageNumber > pageCount) {
      fail(EXIT_INVALID_PDF)
    }

    let page
    try { page = await document.getPage(pageNumber) } catch { fail(EXIT_INVALID_PDF) }
    const rawViewport = rawPageViewport(page)
    const { viewport, width, height } = scaledViewport(page, rawViewport)
    const factory = document.canvasFactory
    const canvasAndContext = factory.create(width, height)
    let pageFailure
    try {
      try {
        await page.render({
          canvas: canvasAndContext.canvas,
          viewport,
          intent: 'display',
          // Canvas rendering includes embedded annotation appearances only. No
          // viewer/scripting layer or document action API is ever invoked.
          annotationMode: pdfjs.AnnotationMode.ENABLE,
          background: '#ffffff',
          isEditing: false,
          recordImages: false,
          recordOperations: false,
        }).promise
        if (resourceState.unavailable) fail(EXIT_UNAVAILABLE)
        if (resourceState.invalidRequest) fail(EXIT_INVALID_PDF)
        if (imageLimitObserved) throw new ResourceLimitError()
      } catch (error) {
        if (resourceState.unavailable) fail(EXIT_UNAVAILABLE)
        if (resourceState.invalidRequest) fail(EXIT_INVALID_PDF)
        if (isImageLimitFailure(error)) throw new ResourceLimitError()
        throw error
      }
      const png = await canvasAndContext.canvas.encode('png')
      if (!(png instanceof Uint8Array)) fail(EXIT_FAILURE)
      if (png.byteLength > MAX_PNG_BYTES) throw new ResourceLimitError()
      await open(outputPath, 'wx').then(async handle => {
        let writeFailure
        try { await handle.writeFile(png) } catch (error) { writeFailure = error; throw error }
        finally { try { await handle.close() } catch (error) { if (!writeFailure) throw error } }
      })
    } catch (error) {
      pageFailure = error
    } finally {
      try { factory.destroy(canvasAndContext) } catch (error) { if (!pageFailure) pageFailure = error }
      try { page.cleanup() } catch (error) { if (!pageFailure) pageFailure = error }
    }
    if (pageFailure) throw pageFailure
  } catch (error) {
    primaryFailure = error
    throw error
  } finally {
    try { await loaded.loadingTask.destroy() } catch (error) { if (!primaryFailure) throw error }
  }
  return pageCount
}

function exitCode(error) {
  if (error instanceof WorkerFailure) return error.exitCode
  if (isImageLimitFailure(error)) return EXIT_RESOURCE_LIMIT
  return EXIT_FAILURE
}

render().then(
  pageCount => {
    try {
      const payload = JSON.stringify({ page_count: pageCount })
      if (writeSync(1, payload) !== Buffer.byteLength(payload)) throw new Error('short protocol write')
    } catch {
      process.exitCode = EXIT_FAILURE
    }
  },
  error => { process.exitCode = exitCode(error) },
)
