import { open, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [modulePath, root, mode] = process.argv.slice(2)
const { ProcessLock, createStorageOwnerId } = await import(pathToFileURL(modulePath).href)
const lock = new ProcessLock({ root, processLockFile: () => join(root, '.process.lock') }, { acquireTimeoutMs: 4000, pollIntervalMs: 2 })
const receive = kind => new Promise(resolve => {
  const listener = value => { if (value === kind) { process.off('message', listener); resolve() } }
  process.on('message', listener)
})
const start = receive('start')
process.send({ kind: 'ready' })
try {
  await start
  if (mode === 'choosing') {
    await lock.initialize()
    await mkdir(join(root, '.lock', 'claims', createStorageOwnerId('c')))
    const release = receive('release')
    process.send({ kind: 'entered' })
    await release
  } else if (mode === 'hold') {
    await lock.withLock(async () => {
      const release = receive('release')
      process.send({ kind: 'entered' })
      await release
    })
  } else {
    for (let index = 0; index < 8; index++) {
      await lock.withLock(async () => {
        const marker = await open(join(root, 'critical'), 'wx')
        try {
          const value = Number(await readFile(join(root, 'counter'), 'utf8'))
          await new Promise(resolve => setImmediate(resolve))
          await writeFile(join(root, 'counter'), String(value + 1))
        } finally { await marker.close(); await rm(join(root, 'critical')) }
      })
    }
  }
  process.send({ kind: 'done' })
} catch (error) {
  process.send({ kind: 'failure', message: error?.stack ?? String(error) })
  process.exitCode = 1
} finally { process.disconnect() }
