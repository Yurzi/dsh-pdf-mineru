import { fork, spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ProcessLock } from '../src/storage/process-lock.js'
import { StoragePaths } from '../src/storage/paths.js'

// Real Windows kernel/filesystem tests; Linux socket semantics are tested separately.
describe.runIf(process.platform === 'win32')('Windows ProcessLock crash recovery', () => {
  let compiledRoot: string
  let moduleUrl: string
  const roots: string[] = []
  const locks: ProcessLock[] = []
  const children: ChildProcess[] = []

  beforeAll(async () => {
    compiledRoot = await mkdtemp(join(tmpdir(), 'mineru-lock-code-'))
    await writeFile(join(compiledRoot, 'package.json'), '{"type":"module"}')
    for (const relative of ['storage/process-lock', 'domain/errors']) {
      const source = await readFile(new URL(`../src/${relative}.ts`, import.meta.url), 'utf8')
      const target = join(compiledRoot, `${relative}.js`)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
      }).outputText)
    }
    moduleUrl = pathToFileURL(join(compiledRoot, 'storage/process-lock.js')).href
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    for (const child of children.splice(0)) {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit')
        child.kill('SIGKILL')
        await exited
      }
    }
    for (const lock of locks.splice(0)) await lock.release()
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  })
  afterAll(async () => { if (compiledRoot) await rm(compiledRoot, { recursive: true, force: true }) })

  async function rootPaths() {
    const root = await mkdtemp(join(tmpdir(), 'mineru-win-lock-'))
    roots.push(root)
    return new StoragePaths(root)
  }
  function lockFor(paths: StoragePaths) {
    const lock = new ProcessLock(paths)
    locks.push(lock)
    return lock
  }
  async function deadPid() {
    const child = spawn(process.execPath, ['-e', ''], { windowsHide: true, stdio: 'ignore' })
    children.push(child)
    await once(child, 'exit')
    expect(child.pid).toBeDefined()
    return child.pid!
  }
  function message(child: ChildProcess): Promise<{ status: string; code?: string }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error('Child lock test timed out')) }, 10000)
      const onMessage = (value: any) => { cleanup(); resolve(value) }
      const onError = (error: Error) => { cleanup(); reject(error) }
      const onExit = () => { cleanup(); reject(new Error('Child exited before replying')) }
      const cleanup = () => {
        clearTimeout(timer)
        child.off('message', onMessage); child.off('error', onError); child.off('exit', onExit)
      }
      child.once('message', onMessage); child.once('error', onError); child.once('exit', onExit)
    })
  }
  async function childFor(paths: StoragePaths) {
    const child = fork(fileURLToPath(new URL('./fixtures/process-lock-child.cjs', import.meta.url)), [moduleUrl, paths.root], {
      execArgv: [], windowsHide: true, stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    })
    children.push(child)
    expect((await message(child)).status).toBe('ready')
    return child
  }
  async function acquireChild(child: ChildProcess) {
    const result = message(child)
    child.send('acquire')
    return result
  }
  function metadata(pid: number, host = hostname()) {
    return JSON.stringify({ pid, ownerToken: 'legacy-owner', createdAt: 0, hostname: host })
  }

  it('recovers a dead legacy PID without changing results or staging', async () => {
    const paths = await rootPaths()
    await mkdir(join(paths.root, 'results'))
    await mkdir(join(paths.root, 'staging'))
    await writeFile(join(paths.root, 'results', 'keep.txt'), 'published')
    await writeFile(join(paths.root, 'staging', 'keep.txt'), 'pending')
    await writeFile(paths.processLockFile(), metadata(await deadPid()))
    const lock = lockFor(paths)
    await lock.acquire()
    expect(lock.isHeld()).toBe(true)
    expect(JSON.parse(await readFile(paths.processLockFile(), 'utf8')).pid).toBe(process.pid)
    expect(await readFile(join(paths.root, 'results', 'keep.txt'), 'utf8')).toBe('published')
    expect(await readFile(join(paths.root, 'staging', 'keep.txt'), 'utf8')).toBe('pending')
    expect((await readdir(paths.root)).filter(name => name.endsWith('.tmp'))).toEqual([])
  })

  it('refuses a live legacy owner (including conservative PID reuse)', async () => {
    const paths = await rootPaths()
    const original = metadata(process.pid)
    await writeFile(paths.processLockFile(), original)
    await expect(lockFor(paths).acquire()).rejects.toMatchObject({ failure: { code: 'STORAGE_LOCKED' } })
    expect(await readFile(paths.processLockFile(), 'utf8')).toBe(original)
  })

  it.each(['{invalid', metadata(1234, 'OTHER-HOST'), '{"pid":-1}'])('preserves ambiguous metadata: %s', async original => {
    const paths = await rootPaths()
    await writeFile(paths.processLockFile(), original)
    await expect(lockFor(paths).acquire()).rejects.toMatchObject({ failure: { code: 'STORAGE_LOCKED' } })
    expect(await readFile(paths.processLockFile(), 'utf8')).toBe(original)
  })

  it('treats permission-denied liveness probes as live', async () => {
    const paths = await rootPaths()
    const original = metadata(1234)
    await writeFile(paths.processLockFile(), original)
    vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('denied'), { code: 'EPERM' }) })
    await expect(lockFor(paths).acquire()).rejects.toMatchObject({ failure: { code: 'STORAGE_LOCKED' } })
    expect(await readFile(paths.processLockFile(), 'utf8')).toBe(original)
  })

  it('reacquires after a real lock owner is forcibly killed', async () => {
    const paths = await rootPaths()
    const child = await childFor(paths)
    expect((await acquireChild(child)).status).toBe('acquired')
    await expect(lockFor(paths).acquire()).rejects.toMatchObject({ failure: { code: 'STORAGE_LOCKED' } })
    const exited = once(child, 'exit')
    child.kill('SIGKILL')
    await exited
    expect(JSON.parse(await readFile(paths.processLockFile(), 'utf8')).pid).toBe(child.pid)
    const restarted = lockFor(paths)
    await restarted.acquire()
    expect(restarted.isHeld()).toBe(true)
  })

  it('allows exactly one process to recover the same stale lock concurrently', async () => {
    const paths = await rootPaths()
    await writeFile(paths.processLockFile(), metadata(await deadPid()))
    const contenders = await Promise.all(Array.from({ length: 6 }, () => childFor(paths)))
    const outcomes = await Promise.all(contenders.map(acquireChild))
    expect(outcomes.filter(outcome => outcome.status === 'acquired')).toHaveLength(1)
    expect(outcomes.filter(outcome => outcome.code === 'STORAGE_LOCKED')).toHaveLength(5)
  })

  it('coordinates Windows path case aliases', async () => {
    const paths = await rootPaths()
    await lockFor(paths).acquire()
    await expect(lockFor(new StoragePaths(paths.root.toUpperCase())).acquire()).rejects.toMatchObject({ failure: { code: 'STORAGE_LOCKED' } })
  })

  it('does not unlink metadata belonging to a replacement owner on release', async () => {
    const paths = await rootPaths()
    const lock = lockFor(paths)
    await lock.acquire()
    const replacement = metadata(process.pid)
    await writeFile(paths.processLockFile(), replacement)
    await lock.release()
    expect(await readFile(paths.processLockFile(), 'utf8')).toBe(replacement)
  })

  it('does not create a lock when acquisition is already cancelled', async () => {
    const paths = await rootPaths()
    await expect(lockFor(paths).acquire(AbortSignal.abort())).rejects.toBeDefined()
    expect(await readdir(paths.root)).toEqual([])
    await lockFor(paths).acquire()
  })

  it('releases the pipe and owned metadata when cancellation follows publication', async () => {
    const paths = await rootPaths()
    let checks = 0
    const signal = {
      throwIfAborted() { if (++checks === 5) throw new Error('cancelled after publication') },
    } as AbortSignal
    await expect(lockFor(paths).acquire(signal)).rejects.toThrow('cancelled after publication')
    expect(await readdir(paths.root)).toEqual([])
    await lockFor(paths).acquire()
  })

  it('preserves a lock that changes while its stale owner is being checked', async () => {
    const paths = await rootPaths()
    await writeFile(paths.processLockFile(), metadata(1234))
    const replacement = metadata(process.pid)
    vi.spyOn(process, 'kill').mockImplementation(() => {
      writeFileSync(paths.processLockFile(), replacement)
      throw Object.assign(new Error('dead'), { code: 'ESRCH' })
    })
    await expect(lockFor(paths).acquire()).rejects.toMatchObject({ failure: { code: 'STORAGE_LOCKED' } })
    expect(await readFile(paths.processLockFile(), 'utf8')).toBe(replacement)
  })
})
