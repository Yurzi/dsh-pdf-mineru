import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { fork, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import { ProcessLock, createStorageOwnerId, storageOwnerState, type ProcessLockScope } from '../src/storage/process-lock.js'
import { StoragePaths } from '../src/storage/paths.js'

let compiled: string
const roots: string[] = []
const workers: ChildProcess[] = []
beforeAll(async () => {
  compiled = await mkdtemp(join(tmpdir(), 'mineru-lock-worker-'))
  await writeFile(join(compiled, 'package.json'), '{"type":"module"}')
  for (const module of ['storage/process-lock', 'domain/errors']) {
    const source = await readFile(new URL(`../src/${module}.ts`, import.meta.url), 'utf8')
    const output = join(compiled, `${module}.js`)
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, transpileModule(source, { compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 } }).outputText)
  }
})
afterEach(async () => {
  for (const child of workers.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
      child.kill('SIGKILL')
      await exited
    }
  }
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
afterAll(async () => { await rm(compiled, { recursive: true, force: true }) })
async function fixture(timeoutMs = 1000) {
  const root = await mkdtemp(join(tmpdir(), 'mineru-lock-'))
  roots.push(root)
  const paths = new StoragePaths(root)
  return { root, paths, lock: new ProcessLock(paths, { acquireTimeoutMs: timeoutMs, pollIntervalMs: 2 }) }
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
async function until(check: () => Promise<boolean>) {
  const deadline = performance.now() + 2000
  while (!await check()) { if (performance.now() > deadline) throw new Error('Fixture synchronization timed out'); await sleep(2) }
}
function worker(root: string, mode: 'loop' | 'hold' | 'choosing') {
  const child = fork(fileURLToPath(new URL('./helpers/process-lock-worker.mjs', import.meta.url)), [join(compiled, 'storage/process-lock.js'), root, mode], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  workers.push(child)
  const messages: Array<{ kind: string; message?: string }> = []
  let stderr = ''
  child.stderr?.on('data', chunk => { stderr += String(chunk) })
  child.on('message', value => { messages.push(value as { kind: string; message?: string }) })
  const exited = new Promise<number | null>(resolve => child.once('exit', resolve))
  return { child, exited, async wait(kind: string) {
    await until(async () => {
      const failure = messages.find(message => message.kind === 'failure')
      if (failure !== undefined) throw new Error(failure.message)
      if (messages.some(message => message.kind === kind)) return true
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Worker exited before ${kind}: ${stderr}`)
      return false
    })
  } }
}

describe('scoped ProcessLock', () => {
  it('never treats a held instance as authority for a concurrent invocation', async () => {
    const { lock } = await fixture()
    const entered = deferred(); const release = deferred()
    let secondEntered = false
    const first = lock.withLock(async () => { entered.resolve(); await release.promise })
    await entered.promise
    const second = lock.withLock(async () => { secondEntered = true })
    await sleep(20)
    expect(secondEntered).toBe(false)
    await lock.release() // An unrelated manual release cannot release a scoped owner.
    expect(secondEntered).toBe(false)
    release.resolve()
    await Promise.all([first, second])
    expect(secondEntered).toBe(true)
  })

  it('cancels a queued waiter without releasing the owner or clogging the queue', async () => {
    const { lock } = await fixture()
    const entered = deferred(); const release = deferred()
    const first = lock.withLock(async () => { entered.resolve(); await release.promise })
    await entered.promise
    const controller = new AbortController(); const reason = new Error('Stop only this waiter')
    const second = lock.withLock(async () => { throw new Error('Cancelled waiter entered') }, controller.signal)
    const rejected = expect(second).rejects.toBe(reason)
    controller.abort(reason); await rejected
    expect(lock.isHeld()).toBe(true)
    release.resolve(); await first
    await expect(lock.withLock(async () => 42)).resolves.toBe(42)
  })

  it('bounds local contention and invalidates explicit scope tokens', async () => {
    const { lock } = await fixture(500)
    let saved!: ProcessLockScope
    await lock.withLock(async scope => {
      saved = scope; lock.assertScope(scope)
      await expect(lock.withLock(async () => undefined)).rejects.toMatchObject({ failure: { code: 'STORAGE_LOCKED' } })
      expect(() => lock.assertScope({} as ProcessLockScope)).toThrow()
    })
    expect(() => lock.assertScope(saved)).toThrow()
    await expect(lock.withLock(async () => { throw new Error('body failure') })).rejects.toThrow('body failure')
    await expect(lock.withLock(async () => true)).resolves.toBe(true)
  })

  it('does not let a later lexicographically smaller claim preempt a holder', async () => {
    const { root, lock } = await fixture()
    await lock.initialize()
    const id = createStorageOwnerId('c').replace(/[0-9a-f]{32}$/, 'f'.repeat(32))
    const holder = join(root, '.lock', 'claims', id)
    await mkdir(holder); await writeFile(join(holder, 'ticket'), '1')
    let entered = false
    const pending = lock.withLock(async () => { entered = true })
    await until(async () => (await readdir(join(root, '.lock', 'claims'))).length === 2)
    await sleep(15); expect(entered).toBe(false)
    await rm(holder, { recursive: true }); await pending
    expect(entered).toBe(true)
  })

  it('publishes a permanent v2 fence and rejects legacy lock files without touching them', async () => {
    const { root, paths, lock } = await fixture()
    const legacy = JSON.stringify({ pid: process.pid, ownerToken: 'legacy', createdAt: 1, hostname: hostname() })
    await writeFile(paths.processLockFile(), legacy)
    await expect(lock.acquire()).rejects.toMatchObject({ failure: { code: 'STORAGE_LOCKED' } })
    expect(await readFile(paths.processLockFile(), 'utf8')).toBe(legacy)
    await rm(paths.processLockFile()) // Explicit fixture migration, not production automatic reclaim.
    await lock.withLock(async () => undefined)
    const fence = JSON.parse(await readFile(paths.processLockFile(), 'utf8'))
    expect(fence.hostname).not.toBe(hostname())
    expect(fence.ownerToken).toBe('mineru-lock-protocol-v2')
    await expect(new ProcessLock(new StoragePaths(root)).withLock(async () => true)).resolves.toBe(true)
  })

  it('rejects symlink roots without writing through them', async () => {
    const { root } = await fixture()
    const target = join(root, 'target'); await mkdir(target)
    const alias = join(root, 'alias'); await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(new ProcessLock(new StoragePaths(alias)).acquire()).rejects.toMatchObject({ failure: { code: 'STORAGE_LOCKED' } })
    expect(await readdir(target)).toEqual([])
  })

  it('fails closed on foreign, malformed, and unverifiable owners', async () => {
    const { root, lock } = await fixture()
    await lock.initialize()
    const id = createStorageOwnerId('c').replace(/_[0-9a-f]{64}_/, `_${'0'.repeat(64)}_`)
    expect(storageOwnerState(id)).toBe('foreign')
    expect(storageOwnerState('c_invalid')).toBe('unknown')
    const claim = join(root, '.lock', 'claims', id)
    await mkdir(claim); await writeFile(join(claim, 'ticket'), '999')
    await expect(lock.acquire()).rejects.toMatchObject({ failure: { code: 'STORAGE_LOCKED' } })
    expect(await readFile(join(claim, 'ticket'), 'utf8')).toBe('999')
  })

  it('serializes real concurrent processes and simultaneous ticket choosers', async () => {
    const { root } = await fixture()
    await writeFile(join(root, 'counter'), '0')
    const peers = Array.from({ length: 3 }, () => worker(root, 'loop'))
    await Promise.all(peers.map(peer => peer.wait('ready')))
    peers.forEach(peer => peer.child.send('start'))
    await Promise.all(peers.map(peer => peer.wait('done')))
    expect(await Promise.all(peers.map(peer => peer.exited))).toEqual([0, 0, 0])
    expect(await readFile(join(root, 'counter'), 'utf8')).toBe('24')
    expect(await readdir(join(root, '.lock', 'claims'))).toEqual([])
  })

  it.each(['hold', 'choosing'] as const)('safely reclaims a crashed %s owner with two real contenders', async mode => {
    const { root } = await fixture()
    await writeFile(join(root, 'counter'), '0')
    const owner = worker(root, mode)
    await owner.wait('ready'); owner.child.send('start'); await owner.wait('entered')
    owner.child.kill('SIGKILL'); await owner.exited
    expect((await readdir(join(root, '.lock', 'claims'))).length).toBe(1)
    const peers = [worker(root, 'loop'), worker(root, 'loop')]
    await Promise.all(peers.map(peer => peer.wait('ready')))
    peers.forEach(peer => peer.child.send('start'))
    await Promise.all(peers.map(peer => peer.wait('done')))
    expect(await Promise.all(peers.map(peer => peer.exited))).toEqual([0, 0])
    expect(await readFile(join(root, 'counter'), 'utf8')).toBe('16')
    expect(await readdir(join(root, '.lock', 'claims'))).toEqual([])
  })
})
