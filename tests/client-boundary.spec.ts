import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const srcRoot = fileURLToPath(new URL('../src/', import.meta.url))
const clientRoot = join(srcRoot, 'client')

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  return (await Promise.all(entries.map(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(path) : Promise.resolve(/\.tsx?$/.test(entry.name) ? [path] : [])
  }))).flat()
}

function imports(source: string) {
  return [...source.matchAll(/\bimport\s+(type\s+)?([\s\S]*?)\s+from\s*['"]([^'"]+)['"]/g)]
    .map(([, typeOnly, bindings = '', specifier = '']) => ({
      specifier,
      typeOnly: Boolean(typeOnly) || (/^\{[\s\S]*\}$/.test(bindings.trim()) &&
        bindings.replace(/[{}]/g, '').split(',').filter(part => part.trim()).every(part => /^\s*type\s/.test(part))),
    }))
}

function allowed(file: string, specifier: string): boolean {
  // External browser packages and client-local modules are not backend edges.
  if (!specifier.startsWith('.')) return !specifier.startsWith('node:')
  const target = relative(srcRoot, resolve(dirname(file), specifier)).split(sep).join('/')
  if (target.startsWith('client/') || target.startsWith('contracts/')) return true
  if (target === 'config/model.js' || target === 'domain/ids.js') return true
  return false
}

describe('client dependency boundary', () => {
  it('imports backend values only from browser-safe leaves', async () => {
    const violations: string[] = []
    for (const file of await sourceFiles(clientRoot)) {
      for (const edge of imports(await readFile(file, 'utf8'))) {
        if (!allowed(file, edge.specifier)) violations.push(relative(srcRoot, file) + ': ' + edge.specifier)
      }
    }
    expect(violations).toEqual([])
  })

  it('recognizes value and type-only imports, including mixed bindings', () => {
    const file = join(clientRoot, 'fixture.ts')
    for (const source of ["import { parseConfig } from '../config.js'", "import { type ProbeView, service } from '../service/mineru-service.js'"]) {
      const edge = imports(source)[0]!
      expect(allowed(file, edge.specifier)).toBe(false)
    }
    const edge = imports("import { type MinerUModel } from '../domain/request.js'")[0]!
    expect(edge.typeOnly).toBe(true)
    expect(allowed(file, edge.specifier)).toBe(false)
  })
})
