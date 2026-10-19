import { describe, it, expect } from 'vitest'
import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { asFileId } from '../src/domain/ids.js'
import type { ArtifactKind } from '../src/domain/request.js'
import { extractSafeZip, validateJsonFile, type ExtractZipTargetFile, type SafeZipLimits } from '../src/providers/http/safe-zip.js'
import { RecordingSink, TEST_LIMITS, tempDir, zip, type ZipEntrySpec } from './support/provider-context.js'

const FILE_1: ExtractZipTargetFile = { fileId: asFileId('mf_0123456789abcdef0123456789_0'), dataId: 'data_doc1', name: 'doc1.pdf' }
const FILE_2: ExtractZipTargetFile = { fileId: asFileId('mf_fedcba9876543210fedcba9876_1'), dataId: 'data_doc2', name: 'doc2.pdf' }
const ALL_ARTIFACTS: readonly ArtifactKind[] = ['markdown', 'layout', 'model-output', 'content-list', 'images']

/** Writes an archive to its own directory; `rename` patches raw entry names (same byte length) yazl refuses to write. */
async function archive(
  entries: Readonly<Record<string, string | Uint8Array>> | readonly ZipEntrySpec[],
  rename?: readonly [placeholder: string, hostile: string],
): Promise<{ readonly dir: string; readonly zipPath: string }> {
  const dir = await tempDir('mineru-zip-')
  const zipPath = join(dir, 'archive.zip')
  let bytes = await zip(entries)
  if (rename !== undefined) {
    const [placeholder, hostile] = rename
    const from = Buffer.from(placeholder)
    const to = Buffer.from(hostile)
    if (from.length !== to.length) throw new Error('rename must preserve byte length')
    bytes = Buffer.from(bytes)
    for (let at = bytes.indexOf(from); at >= 0; at = bytes.indexOf(from, at + from.length)) to.copy(bytes, at)
  }
  await writeFile(zipPath, bytes)
  return { dir, zipPath }
}

async function extract(
  zipPath: string,
  options: { files?: readonly ExtractZipTargetFile[]; required?: readonly ArtifactKind[]; limits?: Partial<SafeZipLimits>; signal?: AbortSignal } = {},
) {
  const sink = new RecordingSink()
  const result = extractSafeZip({
    zipPath, sink,
    files: options.files ?? [FILE_1],
    requiredArtifacts: options.required ?? ['markdown'],
    limits: { ...TEST_LIMITS, ...options.limits },
    signal: options.signal ?? new AbortController().signal,
  })
  return { sink, result }
}

/** The archive was rejected before anything reached the sink, and no staged entry was left behind. */
async function expectNothingStaged(dir: string, sink: RecordingSink): Promise<void> {
  expect(sink.written).toEqual([])
  expect(await readdir(dir)).toEqual(['archive.zip'])
}

describe('extractSafeZip archive layouts', () => {
  it('extracts and normalizes every artifact kind from a root layout', async () => {
    const { dir, zipPath } = await archive({
      'full.md': '# Full Markdown',
      'layout.json': '{"layout":"blocks"}',
      'model.json': '{"model":"vlm"}',
      'content_list.json': '[1,2,3]',
      'images/fig 0.png': 'PNG_FAKE_DATA',
    })
    const { sink, result } = await extract(zipPath, { required: ALL_ARTIFACTS })
    const [collected] = await result
    expect(collected).toMatchObject({ fileId: FILE_1.fileId, name: 'doc1.pdf' })
    expect(collected?.failure).toBeUndefined()
    expect(new Set(collected?.artifacts.map(artifact => artifact.kind))).toEqual(new Set(ALL_ARTIFACTS))
    expect(sink.artifact('markdown')?.toString()).toBe('# Full Markdown')
    expect(sink.written.find(entry => entry.kind === 'images')?.options.relativeName).toBe('images/fig_0.png')
    expect(await readdir(dir)).toEqual(['archive.zip'])
  })

  it('writes an empty images index when images are required but absent', async () => {
    const { zipPath } = await archive({ 'full.md': '# No images' })
    const { sink, result } = await extract(zipPath, { required: ['markdown', 'images'] })
    const [collected] = await result
    expect(collected?.failure).toBeUndefined()
    const index = sink.written.find(entry => entry.kind === 'images')
    expect(index?.options.relativeName).toBe('images/index.json')
    expect(JSON.parse(index!.content.toString())).toEqual({ images: [] })
  })

  it('replicates root artifacts to every target file sharing the archive', async () => {
    const { zipPath } = await archive({ 'full.md': '# Shared Document' })
    const { result } = await extract(zipPath, { files: [FILE_1, FILE_2] })
    const collected = await result
    expect(collected.map(file => file.fileId)).toEqual([FILE_1.fileId, FILE_2.fileId])
    expect(collected.map(file => file.artifacts.length)).toEqual([1, 1])
  })

  it.each([
    ['dataId', (file: ExtractZipTargetFile) => file.dataId],
    ['fileId', (file: ExtractZipTargetFile) => String(file.fileId)],
  ])('routes structured archives by %s top-level directory', async (_label, prefix) => {
    const { zipPath } = await archive({
      [`${prefix(FILE_1)}/full.md`]: '# Doc 1',
      [`${prefix(FILE_2)}/full.md`]: '# Doc 2',
    })
    const { sink, result } = await extract(zipPath, { files: [FILE_1, FILE_2] })
    expect((await result).map(file => file.failure)).toEqual([undefined, undefined])
    expect(sink.written.map(entry => [entry.fileId, entry.content.toString()])).toEqual([
      [FILE_1.fileId, '# Doc 1'], [FILE_2.fileId, '# Doc 2'],
    ])
  })

  it('never guesses a directory from the source file name', async () => {
    const { zipPath } = await archive({ 'doc1/full.md': '# Wrong directory' })
    const { sink, result } = await extract(zipPath)
    const [collected] = await result
    expect(collected?.failure?.code).toBe('REMOTE_PARSE_FAILED')
    expect(sink.written).toEqual([])
  })

  it('rejects normalized output collisions before writing any artifact', async () => {
    const { dir, zipPath } = await archive({ 'layout.json': '{}', 'middle.json': '{}', 'images/a/b.png': 'a', 'images/a_b.png': 'b' })
    const { sink, result } = await extract(zipPath, { required: ['layout', 'images'] })
    await expect(result).rejects.toMatchObject({ failure: { code: 'RESULT_ARCHIVE_INVALID' } })
    await expectNothingStaged(dir, sink)
  })

  it('rejects malformed JSON artifacts and removes the staged entry', async () => {
    const { dir, zipPath } = await archive({ 'layout.json': '{ malformed json ...' })
    const { sink, result } = await extract(zipPath, { required: ['layout'] })
    await expect(result).rejects.toMatchObject({ failure: { code: 'RESULT_ARCHIVE_INVALID' } })
    await expectNothingStaged(dir, sink)
  })
})

describe('extractSafeZip security', () => {
  it.each([
    ['parent traversal', '.._evil.txt', '../evil.txt'],
    ['nested traversal segment', 'a/.._b.txt', 'a/../b.txt'],
    ['dot prefix', 'D_evil.txt', './evil.txt'],
    ['absolute path', 'ABSO_evil.txt', '/evil.txt    '],
    ['Windows drive prefix', 'DRIV_evil.txt', 'C:/evil.txt  '],
    ['backslash separator', 'BSLH_evil.txt', 'dir\\evil.txt '],
    ['NUL byte', 'NULX_file.txt', 'file\0.txt    '],
  ])('rejects an entry name with a %s', async (_label, placeholder, hostile) => {
    const { dir, zipPath } = await archive({ 'full.md': '# Benign', [placeholder]: 'evil' }, [placeholder, hostile])
    const { sink, result } = await extract(zipPath)
    await expect(result).rejects.toMatchObject({ failure: { code: 'RESULT_ARCHIVE_INVALID' } })
    await expectNothingStaged(dir, sink)
  })

  it.each<[string, readonly ZipEntrySpec[], Partial<SafeZipLimits>, string]>([
    ['symlink entries', [{ name: 'full.md', content: '/etc/passwd', mode: 0o120777 }], {}, 'RESULT_ARCHIVE_INVALID'],
    ['too many entries', Array.from({ length: 11 }, (_, i) => ({ name: `images/${String(i)}.png`, content: 'png' })), { maxZipEntries: 10 }, 'RESULT_ARCHIVE_INVALID'],
    ['an oversized entry', [{ name: 'full.md', content: 'A'.repeat(5000) }], { maxZipEntryBytes: 1000 }, 'RESULT_TOO_LARGE'],
    ['an oversized total', ['full.md', 'images/1.png', 'images/2.png'].map(name => ({ name, content: 'A'.repeat(2000) })), { maxZipTotalBytes: 3000 }, 'RESULT_TOO_LARGE'],
    ['a compression bomb', [{ name: 'full.md', content: Buffer.alloc(1024 * 1024) }], { maxZipCompressionRatio: 10 }, 'RESULT_ARCHIVE_INVALID'],
  ])('rejects %s before staging', async (_label, entries, limits, code) => {
    const { dir, zipPath } = await archive(entries)
    const { sink, result } = await extract(zipPath, { required: ['markdown', 'images'], limits })
    await expect(result).rejects.toMatchObject({ failure: { code } })
    await expectNothingStaged(dir, sink)
  })

  it('honors an aborted signal before reading the archive', async () => {
    const { dir, zipPath } = await archive({ 'full.md': '# Markdown' })
    const controller = new AbortController()
    controller.abort()
    const { sink, result } = await extract(zipPath, { signal: controller.signal })
    await expect(result).rejects.toMatchObject({ failure: { code: 'CANCELLED' } })
    await expectNothingStaged(dir, sink)
  })
})

describe('validateJsonFile', () => {
  it('checks the actual staged size, JSON syntax and cancellation', async () => {
    const dir = await tempDir('mineru-json-')
    const valid = join(dir, 'valid.json')
    const invalid = join(dir, 'invalid.json')
    await writeFile(valid, '{"ok":true}          ')
    await writeFile(invalid, '{"invalid":')
    await expect(validateJsonFile(valid)).resolves.toBeUndefined()
    await expect(validateJsonFile(valid, 8)).rejects.toMatchObject({ failure: { code: 'RESULT_TOO_LARGE' } })
    await expect(validateJsonFile(invalid)).rejects.toMatchObject({ failure: { code: 'RESULT_ARCHIVE_INVALID' } })
    const controller = new AbortController()
    const reason = new DOMException('Aborted by user', 'AbortError')
    controller.abort(reason)
    await expect(validateJsonFile(valid, undefined, controller.signal)).rejects.toBe(reason)
  })
})
