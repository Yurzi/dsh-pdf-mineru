import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ZipFile } from 'yazl'
import { asFileId, type MinerUFileId } from '../src/domain/ids.js'
import type { ArtifactKind } from '../src/domain/request.js'
import type { ArtifactRef } from '../src/domain/result.js'
import type {
  ArtifactInput,
  ArtifactSink,
  ArtifactWriteOptions,
  TemporaryArtifact,
} from '../src/providers/provider.js'
import type { SafeZipLimits } from '../src/providers/official-v4-types.js'
import { extractSafeZip, readAllZipEntries, validateJsonFile } from '../src/providers/safe-zip.js'

const SHA256_DUMMY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

class MockArtifactSink implements ArtifactSink {
  readonly written: Array<{
    fileId: MinerUFileId
    kind: ArtifactKind
    input: ArtifactInput
    options: ArtifactWriteOptions
  }> = []

  async writeArtifact(
    fileId: MinerUFileId,
    kind: ArtifactKind,
    input: ArtifactInput,
    options: ArtifactWriteOptions,
  ): Promise<ArtifactRef> {
    let stored: ArtifactInput = input
    if (typeof input !== 'string' && !(input instanceof Uint8Array)) {
      const readable = input instanceof Readable
        ? input
        : Readable.fromWeb(input as import('node:stream/web').ReadableStream<Uint8Array>)
      const chunks: Buffer[] = []
      for await (const chunk of readable) chunks.push(Buffer.from(chunk as Uint8Array))
      stored = Buffer.concat(chunks)
    }
    this.written.push({ fileId, kind, input: stored, options })
    const bytes = typeof stored === 'string'
      ? Buffer.byteLength(stored)
      : stored instanceof Uint8Array
        ? stored.byteLength
        : 0

    return {
      kind,
      relativePath: `files/${String(fileId)}/${options.relativeName ?? 'artifact.bin'}`,
      mediaType: options.mediaType,
      bytes,
      sha256: SHA256_DUMMY,
    }
  }

  async writeTemporary(name: string, input: ArtifactInput, maxBytes: number): Promise<TemporaryArtifact> {
    return {
      path: `/tmp/${name}`,
      bytes: 100,
      sha256: SHA256_DUMMY,
    }
  }
}

describe('safe-zip', () => {
  const tempDirs: string[] = []

  async function createTempZip(populate: (zip: ZipFile) => void): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'mineru-zip-test-'))
    tempDirs.push(dir)
    const zipPath = join(dir, 'test.zip')

    return new Promise((resolve, reject) => {
      const zip = new ZipFile()
      const out = createWriteStream(zipPath)
      out.on('close', () => resolve(zipPath))
      out.on('error', reject)
      zip.outputStream.pipe(out)

      populate(zip)
      zip.end()
    })
  }

  async function patchZipEntryName(zipPath: string, placeholder: string, replacement: string): Promise<void> {
    if (placeholder.length !== replacement.length) {
      throw new Error('Placeholder and replacement must have identical byte length for zip patch')
    }
    const buf = await readFile(zipPath)
    const pBuf = Buffer.from(placeholder, 'utf8')
    const rBuf = Buffer.from(replacement, 'utf8')

    let offset = 0
    let matchCount = 0
    while ((offset = buf.indexOf(pBuf, offset)) !== -1) {
      rBuf.copy(buf, offset)
      offset += pBuf.length
      matchCount++
    }
    if (matchCount === 0) {
      throw new Error(`Placeholder "${placeholder}" not found in zip bytes`)
    }
    await writeFile(zipPath, buf)
  }

  function defaultLimits(overrides: Partial<SafeZipLimits> = {}): SafeZipLimits {
    return {
      maxZipEntries: 100,
      maxZipEntryBytes: 10 * 1024 * 1024,
      maxZipTotalBytes: 50 * 1024 * 1024,
      maxZipCompressionRatio: 50,
      ...overrides,
    }
  }

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(d => rm(d, { recursive: true, force: true })))
  })

  describe('Single-file root layout', () => {
    it('extracts all standard artifacts from root layout', async () => {
      const zipPath = await createTempZip(zip => {
        zip.addBuffer(Buffer.from('# Full Markdown\nContent here', 'utf8'), 'full.md')
        zip.addBuffer(Buffer.from(JSON.stringify({ layout: 'blocks' }), 'utf8'), 'layout.json')
        zip.addBuffer(Buffer.from(JSON.stringify({ model: 'vlm' }), 'utf8'), 'model.json')
        zip.addBuffer(Buffer.from(JSON.stringify({ list: [1, 2, 3] }), 'utf8'), 'content_list.json')
        zip.addBuffer(Buffer.from('PNG_FAKE_DATA', 'utf8'), 'images/fig_0.png')
      })

      const fileId = asFileId('mf_0123456789abcdef0123456789_0')
      const targetFile = { fileId, dataId: 'data_doc1', name: 'doc1.pdf' }
      const sink = new MockArtifactSink()

      const results = await extractSafeZip({
        zipPath,
        sink,
        files: [targetFile],
        requiredArtifacts: ['markdown', 'layout', 'model-output', 'content-list', 'images'],
        limits: defaultLimits(),
        signal: new AbortController().signal,
      })

      expect(results).toHaveLength(1)
      expect(results[0]?.fileId).toBe(fileId)
      expect(results[0]?.failure).toBeUndefined()
      expect(results[0]?.artifacts).toHaveLength(5)

      const kinds = results[0]?.artifacts.map(a => a.kind)
      expect(kinds).toContain('markdown')
      expect(kinds).toContain('layout')
      expect(kinds).toContain('model-output')
      expect(kinds).toContain('content-list')
      expect(kinds).toContain('images')
    })


    it('rejects normalized output collisions before writing artifacts', async () => {
      const zipPath = await createTempZip(zip => {
        zip.addBuffer(Buffer.from('{}'), 'layout.json')
        zip.addBuffer(Buffer.from('{}'), 'middle.json')
        zip.addBuffer(Buffer.from('a'), 'images/a/b.png')
        zip.addBuffer(Buffer.from('b'), 'images/a_b.png')
      })
      const fileId = asFileId('mf_0123456789abcdef0123456789_0')
      const sink = new MockArtifactSink()
      await expect(extractSafeZip({
        zipPath, sink, files: [{ fileId, dataId: 'data_doc1', name: 'doc1.pdf' }],
        requiredArtifacts: ['layout', 'images'], limits: defaultLimits(),
        signal: new AbortController().signal,
      })).rejects.toMatchObject({ failure: { code: 'RESULT_ARCHIVE_INVALID' } })
      expect(sink.written).toHaveLength(0)
    })

    it('writes fallback images/index.json when images are required but absent in zip', async () => {
      const zipPath = await createTempZip(zip => {
        zip.addBuffer(Buffer.from('# Full Markdown\nNo images', 'utf8'), 'full.md')
      })

      const fileId = asFileId('mf_0123456789abcdef0123456789_0')
      const targetFile = { fileId, dataId: 'data_doc1', name: 'doc1.pdf' }
      const sink = new MockArtifactSink()

      const results = await extractSafeZip({
        zipPath,
        sink,
        files: [targetFile],
        requiredArtifacts: ['markdown', 'images'],
        limits: defaultLimits(),
        signal: new AbortController().signal,
      })

      expect(results).toHaveLength(1)
      expect(results[0]?.failure).toBeUndefined()
      expect(results[0]?.artifacts).toHaveLength(2)

      const imgRef = results[0]?.artifacts.find(a => a.kind === 'images')
      expect(imgRef).toBeDefined()
      expect(imgRef?.relativePath).toContain('images/index.json')
    })

    it('replicates root artifacts to all associated target files sharing the same ZIP URL', async () => {
      const zipPath = await createTempZip(zip => {
        zip.addBuffer(Buffer.from('# Shared Document', 'utf8'), 'full.md')
      })

      const fileId1 = asFileId('mf_0123456789abcdef0123456789_0')
      const fileId2 = asFileId('mf_fedcba9876543210fedcba9876_1')
      const targetFiles = [
        { fileId: fileId1, dataId: 'data_doc1', name: 'doc1.pdf' },
        { fileId: fileId2, dataId: 'data_doc2', name: 'doc2.pdf' },
      ]
      const sink = new MockArtifactSink()

      const results = await extractSafeZip({
        zipPath,
        sink,
        files: targetFiles,
        requiredArtifacts: ['markdown'],
        limits: defaultLimits(),
        signal: new AbortController().signal,
      })

      expect(results).toHaveLength(2)
      expect(results[0]?.fileId).toBe(fileId1)
      expect(results[1]?.fileId).toBe(fileId2)
      expect(results[0]?.artifacts).toHaveLength(1)
      expect(results[1]?.artifacts).toHaveLength(1)
    })
  })

  describe('Multi-file subfolder layout', () => {
    it('extracts files matched by dataId top-level directory', async () => {
      const zipPath = await createTempZip(zip => {
        zip.addBuffer(Buffer.from('# Doc 1', 'utf8'), 'data_doc1/full.md')
        zip.addBuffer(Buffer.from(JSON.stringify({ doc: 1 }), 'utf8'), 'data_doc1/layout.json')
        zip.addBuffer(Buffer.from('# Doc 2', 'utf8'), 'data_doc2/full.md')
        zip.addBuffer(Buffer.from(JSON.stringify({ doc: 2 }), 'utf8'), 'data_doc2/layout.json')
      })

      const fileId1 = asFileId('mf_0123456789abcdef0123456789_0')
      const fileId2 = asFileId('mf_fedcba9876543210fedcba9876_1')
      const targetFiles = [
        { fileId: fileId1, dataId: 'data_doc1', name: 'doc1.pdf' },
        { fileId: fileId2, dataId: 'data_doc2', name: 'doc2.pdf' },
      ]
      const sink = new MockArtifactSink()

      const results = await extractSafeZip({
        zipPath,
        sink,
        files: targetFiles,
        requiredArtifacts: ['markdown', 'layout'],
        limits: defaultLimits(),
        signal: new AbortController().signal,
      })

      expect(results).toHaveLength(2)
      expect(results[0]?.fileId).toBe(fileId1)
      expect(results[0]?.failure).toBeUndefined()
      expect(results[1]?.fileId).toBe(fileId2)
      expect(results[1]?.failure).toBeUndefined()
    })

    it('extracts files matched by fileId top-level directory', async () => {
      const fileId1 = asFileId('mf_0123456789abcdef0123456789_0')
      const zipPath = await createTempZip(zip => {
        zip.addBuffer(Buffer.from('# FileId Doc', 'utf8'), `${String(fileId1)}/full.md`)
      })

      const targetFiles = [
        { fileId: fileId1, dataId: 'data_custom_1', name: 'doc1.pdf' },
      ]
      const sink = new MockArtifactSink()

      const results = await extractSafeZip({
        zipPath,
        sink,
        files: targetFiles,
        requiredArtifacts: ['markdown'],
        limits: defaultLimits(),
        signal: new AbortController().signal,
      })

      expect(results).toHaveLength(1)
      expect(results[0]?.failure).toBeUndefined()
      expect(results[0]?.artifacts).toHaveLength(1)
    })

    it('does NOT match by file_name when subfolder differs from dataId and fileId', async () => {
      const zipPath = await createTempZip(zip => {
        zip.addBuffer(Buffer.from('# Wrong name Doc', 'utf8'), 'doc1/full.md')
      })

      const fileId = asFileId('mf_0123456789abcdef0123456789_0')
      const targetFiles = [
        { fileId, dataId: 'data_doc1', name: 'doc1.pdf' },
      ]
      const sink = new MockArtifactSink()

      const results = await extractSafeZip({
        zipPath,
        sink,
        files: targetFiles,
        requiredArtifacts: ['markdown'],
        limits: defaultLimits(),
        signal: new AbortController().signal,
      })

      expect(results).toHaveLength(1)
      expect(results[0]?.failure).toBeDefined()
      expect(results[0]?.failure?.code).toBe('REMOTE_PARSE_FAILED')
    })
  })

  describe('JSON validation', () => {
    it('throws RESULT_ARCHIVE_INVALID if layout.json contains malformed JSON', async () => {
      const zipPath = await createTempZip(zip => {
        zip.addBuffer(Buffer.from('{ malformed json ...', 'utf8'), 'layout.json')
      })

      const fileId = asFileId('mf_0123456789abcdef0123456789_0')
      const targetFiles = [{ fileId, dataId: 'data_doc1', name: 'doc1.pdf' }]
      const sink = new MockArtifactSink()

      await expect(
        extractSafeZip({
          zipPath,
          sink,
          files: targetFiles,
          requiredArtifacts: ['layout'],
          limits: defaultLimits(),
          signal: new AbortController().signal,
        }),
      ).rejects.toThrowError(/Invalid JSON/i)
    })
  })

  describe('Security defenses', () => {
    it('checks the actual staged JSON size before streaming validation', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'mineru-json-size-'))
      tempDirs.push(dir)
      const path = join(dir, 'layout.json')
      await writeFile(path, '{"ok":true}          ')
      await expect(validateJsonFile(path, 8)).rejects.toMatchObject({ failure: { code: 'RESULT_TOO_LARGE' } })
    })


    it('rejects excessive JSON nesting with a fixed frame budget', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'mineru-json-depth-'))
      tempDirs.push(dir)
      const path = join(dir, 'deep.json')
      await writeFile(path, '['.repeat(257) + '0' + ']'.repeat(257))
      await expect(validateJsonFile(path)).rejects.toMatchObject({
        failure: { code: 'RESULT_ARCHIVE_INVALID' },
      })
    })

    it('rejects zip containing path traversal ("../evil.txt")', async () => {
      const zipPath = await createTempZip(zip => {
        zip.addBuffer(Buffer.from('evil', 'utf8'), '.._evil.txt')
      })
      await patchZipEntryName(zipPath, '.._evil.txt', '../evil.txt')

      await expect(
        readAllZipEntries(zipPath, defaultLimits(), new AbortController().signal),
      ).rejects.toThrowError(/traversal|relative path/i)
    })

    it('rejects zip containing absolute path ("/evil.txt")', async () => {
      const zipPath = await createTempZip(zip => {
        zip.addBuffer(Buffer.from('evil', 'utf8'), 'ABSO_evil.txt')
      })
      await patchZipEntryName(zipPath, 'ABSO_evil.txt', '/evil.txt    ')

      await expect(
        readAllZipEntries(zipPath, defaultLimits(), new AbortController().signal),
      ).rejects.toThrowError(/absolute/i)
    })

    it('rejects zip containing Windows drive prefix ("C:/evil.txt")', async () => {
      const zipPath = await createTempZip(zip => {
        zip.addBuffer(Buffer.from('evil', 'utf8'), 'DRIV_evil.txt')
      })
      await patchZipEntryName(zipPath, 'DRIV_evil.txt', 'C:/evil.txt  ')

      await expect(
        readAllZipEntries(zipPath, defaultLimits(), new AbortController().signal),
      ).rejects.toThrowError(/Windows drive prefix|absolute/i)
    })

    it('rejects zip containing backslash ("dir\\evil.txt")', async () => {
      const zipPath = await createTempZip(zip => {
        zip.addBuffer(Buffer.from('evil', 'utf8'), 'BSLH_evil.txt')
      })
      await patchZipEntryName(zipPath, 'BSLH_evil.txt', 'dir\\evil.txt ')

      await expect(
        readAllZipEntries(zipPath, defaultLimits(), new AbortController().signal),
      ).rejects.toThrowError(/backslash/i)
    })

    it('rejects zip containing NUL byte ("file\0.txt")', async () => {
      const zipPath = await createTempZip(zip => {
        zip.addBuffer(Buffer.from('evil', 'utf8'), 'NULX_file.txt')
      })
      await patchZipEntryName(zipPath, 'NULX_file.txt', 'file\0.txt    ')

      await expect(
        readAllZipEntries(zipPath, defaultLimits(), new AbortController().signal),
      ).rejects.toThrowError(/NUL byte/i)
    })

    it('rejects zip containing symlink entries', async () => {
      const zipPath = await createTempZip(zip => {
        // Mode 0o120777 indicates a symbolic link in UNIX file attributes
        zip.addBuffer(Buffer.from('/etc/passwd', 'utf8'), 'symlink_entry', { mode: 0o120777 })
      })

      await expect(
        readAllZipEntries(zipPath, defaultLimits(), new AbortController().signal),
      ).rejects.toThrowError(/Symbolic links/i)
    })

    it('rejects zip exceeding maxZipEntries limit', async () => {
      const zipPath = await createTempZip(zip => {
        for (let i = 0; i < 15; i++) {
          zip.addBuffer(Buffer.from(`content ${i}`, 'utf8'), `file_${i}.txt`)
        }
      })

      await expect(
        readAllZipEntries(zipPath, defaultLimits({ maxZipEntries: 10 }), new AbortController().signal),
      ).rejects.toThrowError(/entries/i)
    })

    it('rejects zip exceeding maxZipEntryBytes limit', async () => {
      const largeContent = Buffer.alloc(5000, 'A')
      const zipPath = await createTempZip(zip => {
        zip.addBuffer(largeContent, 'large.txt')
      })

      await expect(
        readAllZipEntries(zipPath, defaultLimits({ maxZipEntryBytes: 1000 }), new AbortController().signal),
      ).rejects.toThrowError(/entry/i)
    })

    it('rejects zip exceeding maxZipTotalBytes limit', async () => {
      const content = Buffer.alloc(2000, 'A')
      const zipPath = await createTempZip(zip => {
        zip.addBuffer(content, 'file1.txt')
        zip.addBuffer(content, 'file2.txt')
        zip.addBuffer(content, 'file3.txt')
      })

      await expect(
        readAllZipEntries(zipPath, defaultLimits({ maxZipTotalBytes: 3000 }), new AbortController().signal),
      ).rejects.toThrowError(/total/i)
    })

    it('rejects zip exceeding compression ratio (Zip Bomb protection)', async () => {
      // Create a 1MB buffer of zeros which compresses into ~1KB (ratio > 500)
      const bombData = Buffer.alloc(1024 * 1024, 0)
      const zipPath = await createTempZip(zip => {
        zip.addBuffer(bombData, 'bomb.txt')
      })

      await expect(
        readAllZipEntries(zipPath, defaultLimits({ maxZipCompressionRatio: 10 }), new AbortController().signal),
      ).rejects.toThrowError(/compression ratio/i)
    })

    it('honors abort signal during extraction', async () => {
      const zipPath = await createTempZip(zip => {
        zip.addBuffer(Buffer.from('# Markdown', 'utf8'), 'full.md')
      })

      const controller = new AbortController()
      controller.abort()

      await expect(
        readAllZipEntries(zipPath, defaultLimits(), controller.signal),
      ).rejects.toThrowError(/cancelled/i)
    })
  })
})
