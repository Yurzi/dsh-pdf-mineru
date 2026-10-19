/**
 * Run `dsh web` for the isolated profile on a free loopback port.
 */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createWriteStream } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { type E2EContext, run } from './environment.js'

/** A running `dsh web`. */
export interface WebServer {
  /**
   * The one-time launch URL. Visiting it trades the token for an HttpOnly
   * cookie bound to this host and port, then redirects to the app.
   */
  readonly url: string
  stop(): Promise<void>
}

/** `dsh web` output, kept after the run for inspection. */
export const webLog = join(run, 'web.log')

/**
 * Start the GUI on a free loopback port, never the default 3080 a developer may be using.
 * @param e2e - the run's install and environment.
 * @returns the server once it printed its launch URL.
 */
export async function startWeb(e2e: E2EContext): Promise<WebServer> {
  const port = await freePort()
  const child = spawn(e2e.cli, ['web', '--no-open', '--host', '127.0.0.1', '--port', String(port)], { cwd: run, env: e2e.env })
  const log = createWriteStream(webLog, { flags: 'a' })
  child.stdout.pipe(log)
  child.stderr.pipe(log)
  const pattern = new RegExp(`http://127\\.0\\.0\\.1:${port}/\\?token=[\\w.~-]+`)
  let output = ''
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error(`dsh web printed no launch URL; see ${webLog}`)) }, 90_000)
    const read = (chunk: Buffer) => {
      output += chunk.toString()
      const match = pattern.exec(output)
      if (match !== null) {
        clearTimeout(timer)
        resolve(match[0])
      }
    }
    child.stdout.on('data', read)
    child.stderr.on('data', read)
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`dsh web exited with ${code}; see ${webLog}`))
    })
  })
  return {
    url,
    async stop() {
      if (child.exitCode !== null) return
      child.kill('SIGTERM')
      await once(child, 'exit')
    },
  }
}

/** A loopback port nothing listens on right now. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => { resolve(typeof address === 'object' && address !== null ? address.port : 0) })
    })
  })
}
