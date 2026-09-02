// Load the real TypeScript implementation compiled by the parent test.
const { join } = require('node:path')

async function main() {
  const { ProcessLock } = await import(process.argv[2])
  const root = process.argv[3]
  const lock = new ProcessLock({ root, processLockFile: () => join(root, '.process.lock') })
  process.on('message', async (message) => {
    if (message !== 'acquire') return
    try {
      await lock.acquire()
      process.send({ status: 'acquired', pid: process.pid })
    } catch (error) {
      process.send({ status: 'blocked', code: error.failure?.code || error.code })
    }
  })
  process.send({ status: 'ready' })
}
main().catch(error => { console.error(error); process.exitCode = 1 })
