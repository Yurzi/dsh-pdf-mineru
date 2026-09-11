import { mkdtemp, rm } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { HostConnectionService, serverResponseSchema } from '@deepseek-ai/dsh-client-connection'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as mineru from '../src/index.js'
import { defaultMinerUConfig } from '../src/config.js'
import { RPC_CHANNEL } from '../src/rpc.js'

// Intentionally no module mocks: strict Cordis service tracing and the installed
// rc.2 connection adapter are the behavior under test, not a fake ctx.inject.
interface Route {
  kind: string
  path: string
  handler(req: IncomingMessage, res: ServerResponse): Promise<void>
}

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function hostFixture(trustedHosts: readonly string[] = []) {
  const root = await mkdtemp(join(tmpdir(), 'mineru-host-compatibility-'))
  const ctx = new Context()
  cleanups.push(async () => {
    try { await ctx.fiber.dispose() } finally { await rm(root, { recursive: true, force: true }) }
  })
  const base = defaultMinerUConfig()
  const config = { ...base, storage: { ...base.storage, storageRoot: join(root, 'store') } }
  const fibers = new Set<Fiber>()
  ctx.on('internal/plugin', fiber => { if (fiber.uid !== null) fibers.add(fiber) })
  const errors: unknown[][] = []
  ctx.logger.exporter({ export: message => { if (message.type === 'error') errors.push(message.args) } })

  const definitions = new Map<string, { name: string }>()
  const toolDisposers: Array<ReturnType<typeof vi.fn>> = []
  const registerTool = vi.fn((definition: { name: string }) => {
    if (definitions.has(definition.name)) throw new Error('duplicate tool registration')
    definitions.set(definition.name, definition)
    const dispose = vi.fn(() => { definitions.delete(definition.name) })
    toolDisposers.push(dispose)
    return dispose
  })
  const unwatch = vi.fn()
  const registerSettings = vi.fn(() => ({
    get: () => config,
    watch: () => unwatch,
    replace: vi.fn(async () => undefined),
  }))
  const startJob = vi.fn(() => { throw new Error('lifecycle tests must not start jobs') })
  // Provide services through Cordis, never assign properties onto the root:
  // own properties would bypass the strict injected-service lookup.
  ctx.provide('tools', { register: registerTool })
  ctx.provide('settings', { register: registerSettings, mutate: vi.fn(async () => undefined) })
  ctx.provide('jobs', { start: startJob })

  const routes = new Map<string, Route>()
  const routeDisposers: Array<ReturnType<typeof vi.fn>> = []
  const registerRoute = vi.fn((route: Route) => {
    if (routes.has(route.path)) throw new Error('duplicate route registration')
    routes.set(route.path, route)
    const dispose = vi.fn(() => { routes.delete(route.path) })
    routeDisposers.push(dispose)
    return dispose
  })
  // A root-owned WebServer would be visible through the root ancestor store
  // even without inject, hiding the regression. Use a sibling provider fiber.
  const provideWebServer = () => {
    const provider = ctx.plugin((owner: Context) => { owner.provide('webServer', { register: registerRoute }) })
    return () => provider.dispose()
  }
  // Authentication is a fixture boundary only. No BrowserAuth.create(), secret
  // store, credentials, listening socket, or live provider is used. Host/Origin
  // validation and the HTTP-to-Fetch RPC bridge remain the real implementation.
  const isAuthenticated = vi.fn(() => true)
  const provideConnection = () => ctx.plugin((owner: Context) => {
    new HostConnectionService(owner, trustedHosts, {
      isAuthenticated,
    } as unknown as ConstructorParameters<typeof HostConnectionService>[2])
  })
  const settle = async () => {
    // A plugin's await() does not await its ctx.inject children. Walk every
    // observed fiber, including children added during asynchronous startup, so
    // Cordis cannot swallow an injection error and leave a false-positive test.
    for (const fiber of fibers) {
      if (fiber.uid !== null) await fiber.await()
    }
  }
  const start = async () => {
    const plugin = ctx.plugin(mineru, config)
    await settle()
    expect(plugin.state).toBe(ctx.fiber.state)
    return plugin
  }
  const expectTools = () => {
    expect([...definitions.keys()].sort()).toEqual(['async_parse_pdf', 'read_pdf'])
    expect(registerTool).toHaveBeenCalledTimes(2)
    expect(startJob).not.toHaveBeenCalled()
  }
  return {
    ctx, config, errors, definitions, registerTool, toolDisposers, unwatch,
    registerSettings, routes, registerRoute, routeDisposers, isAuthenticated,
    provideWebServer, provideConnection, settle, start, expectTools,
  }
}

// Exercise the actual registered node:http handler entirely in memory.
async function request(route: Route, options: { host?: string | string[] | null; endpoint?: string; origin?: string } = {}) {
  const { host = '127.0.0.1:3080', endpoint = 'mineru/config.get', origin } = options
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify({
    type: 'client-request', rpcId: 'fixture-rpc', method: endpoint, payload: {},
  }))]), {
    method: 'POST', url: RPC_CHANNEL + '/' + endpoint,
    headers: { ...(host === null ? {} : { host }), ...(origin === undefined ? {} : { origin }), 'content-type': 'application/json' },
  })
  const chunks: Buffer[] = []
  let status = 0
  const res = Object.assign(new Writable({
    write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback() },
  }), {
    writeHead(code: number) { status = code; return this },
  })
  try {
    await route.handler(req as unknown as IncomingMessage, res as unknown as ServerResponse)
    return { status, body: Buffer.concat(chunks).toString('utf8') }
  } finally {
    req.destroy()
    res.destroy()
  }
}

describe('installed host compatibility (rc.2 RPC injection)', () => {
  it('loads the real plugin in a strict fiber, serves loopback RPC, and disposes its registrations', async () => {
    const host = await hostFixture()
    host.provideWebServer()
    const connection = host.provideConnection()
    await connection.await()
    const plugin = await host.start()

    host.expectTools()
    expect(host.registerRoute).toHaveBeenCalledOnce()
    const route = host.routes.get(RPC_CHANNEL)!
    expect(route).toMatchObject({ kind: 'prefix', path: RPC_CHANNEL, handler: expect.any(Function) })
    const response = await request(route)
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({
      type: 'server-response', rpcId: 'fixture-rpc',
      result: { ok: true, value: { config: host.config } },
    })
    // rc.2 enforces trust inside the connection handler, not a route.authority
    // field. With no extra trusted hosts, a non-loopback authority is refused.
    expect(await request(route, { host: 'remote.example:3080' })).toEqual({ status: 403, body: 'forbidden' })
    expect(host.isAuthenticated).toHaveBeenCalledOnce()

    await plugin.dispose()
    expect(connection.state).toBe(host.ctx.fiber.state)
    expect(host.routes.size).toBe(0)
    expect(host.definitions.size).toBe(0)
    expect(host.unwatch).toHaveBeenCalledOnce()
    for (const dispose of [...host.routeDisposers, ...host.toolDisposers]) expect(dispose).toHaveBeenCalledOnce()
    await plugin.dispose()
    for (const dispose of [...host.routeDisposers, ...host.toolDisposers]) expect(dispose).toHaveBeenCalledOnce()
    expect(host.errors).toEqual([])
  })

  it('keeps maintenance loopback-only even when the host trusts authenticated remote clients', async () => {
    const host = await hostFixture(['remote.example:3080'])
    host.provideWebServer()
    await host.provideConnection().await()
    const plugin = await host.start()
    const route = host.routes.get(RPC_CHANNEL)!
    // Prove this is a channel-local restriction, not rejection by the global
    // trust fence or authentication fixture: native Connection allows this host.
    expect(host.ctx.get('connection')!.requestRejection({ headers: { host: 'remote.example:3080' } })).toBeUndefined()
    host.isAuthenticated.mockClear()
    expect(await request(route, { host: 'remote.example:3080', endpoint: 'mineru/storage.stats' }))
      .toEqual({ status: 403, body: 'forbidden' })
    expect(host.isAuthenticated).not.toHaveBeenCalled()
    const local = await request(route, { endpoint: 'mineru/storage.stats' })
    expect(local.status).toBe(200)
    expect(JSON.parse(local.body).result.ok).toBe(true)
    expect(host.errors).toEqual([])
    await plugin.dispose()
  })

  it('retains native authentication, Origin validation, and error envelopes after wrapping the route', async () => {
    const host = await hostFixture()
    host.provideWebServer()
    await host.provideConnection().await()
    await host.start()
    const route = host.routes.get(RPC_CHANNEL)!
    host.isAuthenticated.mockReturnValueOnce(false)
    expect(await request(route)).toEqual({ status: 401, body: 'unauthorized' })
    expect(await request(route, { origin: 'https://remote.example' })).toEqual({ status: 403, body: 'forbidden' })
    const unknown = await request(route, { endpoint: 'mineru/unknown' })
    expect(unknown.status).toBe(200)
    expect(serverResponseSchema.parse(JSON.parse(unknown.body))).toEqual({
      type: 'server-response', rpcId: 'fixture-rpc',
      result: { ok: false, error: { code: 'mineru/not-found', message: 'unknown endpoint: mineru/unknown', details: {} } },
    })
    const invalid = await request(route, { endpoint: 'mineru/config.set' })
    expect(invalid.status).toBe(200)
    expect(serverResponseSchema.parse(JSON.parse(invalid.body))).toEqual({
      type: 'server-response', rpcId: 'fixture-rpc',
      result: { ok: false, error: {
        code: 'mineru/invalid-argument', message: 'payload.config must be a non-null configuration object', details: {},
      } },
    })
    expect(host.errors).toEqual([])
  })

  it('accepts bare loopback authorities and rejects missing, malformed, and disguised non-loopback Hosts', async () => {
    const host = await hostFixture(['remote.example'])
    host.provideWebServer()
    await host.provideConnection().await()
    await host.start()
    const route = host.routes.get(RPC_CHANNEL)!
    for (const authority of ['localhost', 'LOCALHOST:3080', '127.0.0.1:80', '127.2.3.4:3080', '[::1]:3080']) {
      expect((await request(route, { host: authority })).status, authority).toBe(200)
    }
    for (const authority of [null, ['localhost', 'remote.example'], '', 'remote.example', 'localhost.remote.example',
      'localhost@remote.example', 'remote.example@localhost', 'localhost/path', 'localhost?query',
      ' localhost', 'localhost ', 'localhost\n', 'localhost\r\n', 'localhost:65536', '127.0.0.256', '127.0.0.1#remote.example']) {
      expect(await request(route, { host: authority }), String(authority)).toEqual({ status: 403, body: 'forbidden' })
    }
    expect(host.errors).toEqual([])
  })

  it.each(['connection', 'webServer', 'both'] as const)('keeps both tools available without %s', async missing => {
    const host = await hostFixture()
    if (missing === 'connection') host.provideWebServer()
    if (missing === 'webServer') await host.provideConnection().await()
    const plugin = await host.start()
    host.expectTools()
    expect(host.registerRoute).not.toHaveBeenCalled()
    expect(host.errors).toEqual([])
    await plugin.dispose()
    expect(host.definitions.size).toBe(0)
    expect(host.unwatch).toHaveBeenCalledOnce()
    for (const dispose of host.toolDisposers) expect(dispose).toHaveBeenCalledOnce()
  })

  it.each(['connection', 'webServer'] as const)('activates RPC when %s arrives late, and removes only RPC when it leaves', async late => {
    const host = await hostFixture()
    if (late === 'connection') host.provideWebServer()
    else await host.provideConnection().await()
    const plugin = await host.start()
    host.expectTools()
    expect(host.registerRoute).not.toHaveBeenCalled()

    const provideLate = async () => {
      if (late === 'webServer') return host.provideWebServer()
      const connection = host.provideConnection()
      await connection.await()
      return () => connection.dispose()
    }
    const remove = await provideLate()
    await host.settle()
    expect(host.routes.has(RPC_CHANNEL)).toBe(true)
    expect(host.registerRoute).toHaveBeenCalledOnce()
    host.expectTools()

    await remove()
    await host.settle()
    expect(host.routes.size).toBe(0)
    expect(host.routeDisposers[0]).toHaveBeenCalledOnce()
    expect(plugin.state).toBe(host.ctx.fiber.state)
    host.expectTools()
    expect(host.unwatch).not.toHaveBeenCalled()

    await provideLate()
    await host.settle()
    expect(host.routes.has(RPC_CHANNEL)).toBe(true)
    expect(host.registerRoute).toHaveBeenCalledTimes(2)
    expect(host.registerSettings).toHaveBeenCalledOnce()
    host.expectTools()
    await plugin.dispose()
    expect(host.routes.size).toBe(0)
    expect(host.definitions.size).toBe(0)
    for (const dispose of host.routeDisposers) expect(dispose).toHaveBeenCalledOnce()
    expect(host.errors).toEqual([])
  })

  it.each([
    { label: 'old connection-only', inject: ['connection'] },
    { label: 'plain connection + webServer', inject: ['connection', 'webServer'] },
  ])('negative control: $label scope fails without the caller-local registrar', async ({ inject }) => {
    const host = await hostFixture()
    host.provideWebServer()
    await host.provideConnection().await()
    // Reproduce both the old missing dependency and Cordis's provider-shadow
    // lookup with both dependencies declared. Root-owned services hide these
    // failures; the scoped registrar is necessary even for the latter case.
    const legacy = host.ctx.inject(inject, ctx => {
      return ctx.connection.rpc.handle(RPC_CHANNEL, async () => ({ ok: true, value: {} }))
    })
    const failure = await legacy.await().then(() => undefined, error => error as Error)
    expect(failure?.message).toBe('cannot get property "webServer" without inject')
    expect(host.registerRoute).not.toHaveBeenCalled()
    await legacy.dispose()
  })
})
