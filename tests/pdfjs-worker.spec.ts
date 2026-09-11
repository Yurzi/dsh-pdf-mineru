import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildPdfjsArgs } from '../src/service/pdfjs-backend.js'

interface WorkerResult {
  readonly exitCode: number | null
  readonly stdout: Buffer
  readonly stderr: Buffer
}

function makePdf(mediaBox = '0 0 200 100', rotate?: number): Buffer {
  const stream = 'BT /F1 20 Tf 20 50 Td (offline PDF.js fixture) Tj ET'
  const pageOptions = rotate === undefined ? '' : ' /Rotate ' + String(rotate)
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [' + mediaBox + ']' + pageOptions
      + ' /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + String(Buffer.byteLength(stream)) + ' >>\nstream\n' + stream + '\nendstream',
  ]
  let body = '%PDF-1.7\n% fixture\n'
  const offsets = [0]
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(body))
    body += String(index + 1) + ' 0 obj\n' + objects[index] + '\nendobj\n'
  }
  const xrefOffset = Buffer.byteLength(body)
  body += 'xref\n0 ' + String(objects.length + 1) + '\n'
  body += '0000000000 65535 f \n'
  for (const offset of offsets.slice(1)) body += String(offset).padStart(10, '0') + ' 00000 n \n'
  body += 'trailer\n<< /Size ' + String(objects.length + 1) + ' /Root 1 0 R >>\n'
  body += 'startxref\n' + String(xrefOffset) + '\n%%EOF\n'
  return Buffer.from(body)
}

function assemblePdf(objects: readonly string[]): Buffer {
  let body = '%PDF-1.7\n% fixture\n'
  const offsets = [0]
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(body))
    body += String(index + 1) + ' 0 obj\n' + objects[index] + '\nendobj\n'
  }
  const xrefOffset = Buffer.byteLength(body)
  body += 'xref\n0 ' + String(objects.length + 1) + '\n0000000000 65535 f \n'
  for (const offset of offsets.slice(1)) body += String(offset).padStart(10, '0') + ' 00000 n \n'
  body += 'trailer\n<< /Size ' + String(objects.length + 1) + ' /Root 1 0 R >>\n'
  body += 'startxref\n' + String(xrefOffset) + '\n%%EOF\n'
  return Buffer.from(body)
}

function makeInteractivePdf(): Buffer {
  const pageStream = 'BT /F1 20 Tf 20 50 Td (offline PDF.js fixture) Tj ET'
  const appearance = '1 0 0 RG 6 w 0 0 50 30 re S'
  return assemblePdf([
    '<< /Type /Catalog /Pages 2 0 R /OpenAction 6 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100]'
      + ' /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R /Annots [7 0 R] >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + String(Buffer.byteLength(pageStream)) + ' >>\nstream\n' + pageStream + '\nendstream',
    '<< /Type /Action /S /JavaScript'
      + ' /JS <6170702e6c61756e636855524c2822687474703a2f2f3132372e302e302e313a392f6e657665722229> >>',
    '<< /Type /Annot /Subtype /Square /Rect [130 55 180 85] /F 0'
      + ' /A << /S /URI /URI (http://127.0.0.1:9/external) >> /AP << /N 8 0 R >> >>',
    '<< /Type /XObject /Subtype /Form /BBox [0 0 50 30] /Resources << >> /Length '
      + String(Buffer.byteLength(appearance)) + ' >>\nstream\n' + appearance + '\nendstream',
  ])
}

function makeOversizedImagePdf(): Buffer {
  const pageStream = 'q 100 0 0 100 0 0 cm /Im1 Do Q'
  return assemblePdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100]'
      + ' /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>',
    '<< /Length ' + String(Buffer.byteLength(pageStream)) + ' >>\nstream\n' + pageStream + '\nendstream',
    '<< /Type /XObject /Subtype /Image /Width 2000 /Height 2000'
      + ' /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 1 >>\nstream\n0\nendstream',
  ])
}

function runWorker(args: readonly string[]): Promise<WorkerResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [...args], {
      env: { ...process.env },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', chunk => stdout.push(chunk as Buffer))
    child.stderr.on('data', chunk => stderr.push(chunk as Buffer))
    child.once('error', rejectPromise)
    child.once('close', exitCode => {
      resolvePromise({ exitCode, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) })
    })
  })
}

describe('PDF.js page worker', () => {
  let root: string
  let snapshotPath: string
  let outputPath: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mineru-pdfjs-worker-test-'))
    snapshotPath = join(root, 'source.pdf')
    outputPath = join(root, 'page.png')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('builds fixed Node arguments with the four-field worker protocol last', () => {
    const args = buildPdfjsArgs('/private/snapshot.pdf', '/private/page.png', 7, 12345)
    expect(args.slice(0, 3)).toEqual([
      '--max-old-space-size=512', '--disallow-code-generation-from-strings', '--no-warnings',
    ])
    expect(basename(args[3]!)).toBe('pdfjs-worker.mjs')
    expect(args.slice(-4)).toEqual(['/private/snapshot.pdf', '/private/page.png', '7', '12345'])
    expect(args).toHaveLength(8)
  })

  it('renders a real one-page PDF offline with controlled stdout only', async () => {
    const source = makePdf()
    await writeFile(snapshotPath, source)
    const result = await runWorker(buildPdfjsArgs(snapshotPath, outputPath, 1, source.byteLength))

    expect(result).toMatchObject({ exitCode: 0 })
    expect(result.stdout.toString()).toBe('{"page_count":1}')
    expect(result.stderr).toHaveLength(0)
    const png = await readFile(outputPath)
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(png.readUInt32BE(16)).toBe(1600)
    expect(png.readUInt32BE(20)).toBe(800)
    expect(png.byteLength).toBeLessThanOrEqual(8 * 1024 * 1024)
  })

  it('honors page rotation before computing the bounded render scale', async () => {
    const source = makePdf('0 0 200 100', 90)
    await writeFile(snapshotPath, source)
    const result = await runWorker(buildPdfjsArgs(snapshotPath, outputPath, 1, source.byteLength))

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toHaveLength(0)
    const png = await readFile(outputPath)
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([800, 1600])
  })

  it('uses exit 21 without diagnostics for invalid PDFs and page ranges', async () => {
    await writeFile(snapshotPath, 'not a PDF at a private path')
    let result = await runWorker(buildPdfjsArgs(snapshotPath, outputPath, 1, 1024))
    expect(result).toEqual({ exitCode: 21, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) })

    const source = makePdf()
    await writeFile(snapshotPath, source)
    result = await runWorker(buildPdfjsArgs(snapshotPath, outputPath, 2, source.byteLength))
    expect(result).toEqual({ exitCode: 21, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) })
  })

  it('rejects input and raw page resource limits before Canvas allocation', async () => {
    let source = makePdf()
    await writeFile(snapshotPath, source)
    let result = await runWorker(buildPdfjsArgs(snapshotPath, outputPath, 1, source.byteLength - 1))
    expect(result).toEqual({ exitCode: 22, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) })

    await truncate(snapshotPath, 200 * 1024 * 1024 + 1)
    result = await runWorker(buildPdfjsArgs(snapshotPath, outputPath, 1, 201 * 1024 * 1024))
    expect(result).toEqual({ exitCode: 22, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) })

    source = makePdf('0 0 1000001 10')
    await writeFile(snapshotPath, source)
    result = await runWorker(buildPdfjsArgs(snapshotPath, outputPath, 1, source.byteLength))
    expect(result).toEqual({ exitCode: 22, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) })
  })

  it('renders annotation appearances without executing actions or external URIs', async () => {
    const plain = makePdf()
    await writeFile(snapshotPath, plain)
    let result = await runWorker(buildPdfjsArgs(snapshotPath, outputPath, 1, plain.byteLength))
    expect(result.exitCode).toBe(0)
    const plainPng = await readFile(outputPath)

    const interactive = makeInteractivePdf()
    const interactiveOutput = join(root, 'interactive.png')
    await writeFile(snapshotPath, interactive)
    result = await runWorker(buildPdfjsArgs(snapshotPath, interactiveOutput, 1, interactive.byteLength))
    expect(result).toMatchObject({ exitCode: 0, stderr: Buffer.alloc(0) })
    expect(result.stdout.toString()).toBe('{"page_count":1}')
    expect(await readFile(interactiveOutput)).not.toEqual(plainPng)
  })

  it('maps oversized embedded image resources to exit 22', async () => {
    const source = makeOversizedImagePdf()
    await writeFile(snapshotPath, source)
    const result = await runWorker(buildPdfjsArgs(snapshotPath, outputPath, 1, source.byteLength))
    expect(result).toEqual({ exitCode: 22, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) })
  })

  it('uses exit 23 for output failures without exposing paths', async () => {
    const source = makePdf()
    await writeFile(snapshotPath, source)
    await writeFile(outputPath, 'pre-existing')
    const result = await runWorker(buildPdfjsArgs(snapshotPath, outputPath, 1, source.byteLength))
    expect(result).toEqual({ exitCode: 23, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) })
  })
})
