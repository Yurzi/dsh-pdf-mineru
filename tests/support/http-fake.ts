import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { onTestFinished, vi } from 'vitest'

/** A canned upstream reply shared by the loopback server and the fetch stub. */
export interface CannedReply {
  readonly status: number
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: string | Uint8Array
}

export const json = (status: number, payload: unknown, headers: Readonly<Record<string, string>> = {}): CannedReply =>
  ({ status, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload) })

export const text = (status: number, body = '', headers: Readonly<Record<string, string>> = {}): CannedReply =>
  ({ status, headers, body })

const SEQUENCE = Symbol('sequence')

/** Replies in order; the last reply repeats once the list is exhausted. */
export interface Sequence<T> {
  readonly [SEQUENCE]: () => T
}

export function seq<T>(...replies: readonly [T, ...T[]]): Sequence<T> {
  let index = 0
  return { [SEQUENCE]: () => replies[Math.min(index++, replies.length - 1)]! }
}

function isSequence<T>(value: unknown): value is Sequence<T> {
  return typeof value === 'object' && value !== null && SEQUENCE in value
}

function isCanned(value: unknown): value is CannedReply {
  return typeof value === 'object' && value !== null && 'status' in value
}

/** Keys are `METHOD /path` (`METHOD https://host/path` for stubFetch); `*` matches anything else. */
function routeFor<R>(routes: Readonly<Record<string, R>>, method: string, target: string): R | undefined {
  return routes[`${method} ${target}`] ?? routes['*']
}

function matches(key: string, method: string, target: string): boolean {
  return key.includes(' ') ? key === `${method} ${target}` : key === target
}

export interface Deferred<T = void> {
  readonly promise: Promise<T>
  resolve(value: T): void
}

/** A promise with an external resolve, for "request arrived" / "may continue" gates. */
export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

// Loopback HTTP upstream (self-hosted providers, http-client) ------------------------------

export interface RecordedRequest {
  readonly method: string
  readonly url: string
  readonly headers: IncomingHttpHeaders
  readonly body: Buffer
}

export type ServerHandler = (request: RecordedRequest, res: ServerResponse) => void | Promise<void>
export type ServerRoute = CannedReply | ServerHandler | Sequence<CannedReply | ServerHandler>

export interface FakeUpstream {
  readonly url: string
  readonly requests: readonly RecordedRequest[]
  /** Requests for `METHOD /path`, or for `/path` with any method. */
  requestsFor(key: string): readonly RecordedRequest[]
  close(): Promise<void>
}

/** Never answers; the client must time out or abort. */
export const hang: ServerHandler = () => {}

function writeCanned(res: ServerResponse, reply: CannedReply): void {
  res.writeHead(reply.status, { ...reply.headers })
  res.end(reply.body)
}

/** Starts a loopback server answering from a route table (unrouted: 404); closed when the test finishes. */
export async function fakeUpstream(routes: Readonly<Record<string, ServerRoute>>): Promise<FakeUpstream> {
  const requests: RecordedRequest[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const request: RecordedRequest = {
        method: req.method ?? 'GET', url: req.url ?? '/', headers: req.headers, body: Buffer.concat(chunks),
      }
      requests.push(request)
      let route = routeFor(routes, request.method, request.url)
      if (isSequence<CannedReply | ServerHandler>(route)) route = route[SEQUENCE]()
      if (route === undefined) return writeCanned(res, text(404))
      if (isCanned(route)) return writeCanned(res, route)
      void Promise.resolve(route(request, res)).catch(() => {
        if (!res.headersSent) writeCanned(res, text(500))
        else res.destroy()
      })
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  let closed: Promise<void> | undefined
  const close = (): Promise<void> => {
    closed ??= new Promise<void>(resolve => {
      server.closeAllConnections()
      server.close(() => resolve())
    })
    return closed
  }
  onTestFinished(close)
  return {
    url: `http://127.0.0.1:${String(port)}`,
    requests,
    requestsFor: key => requests.filter(request => matches(key, request.method, request.url)),
    close,
  }
}

// Global fetch stub (official-v4 HTTPS API, presigned PUT and CDN URLs) --------------------

export interface FetchCall {
  readonly method: string
  readonly url: string
  /** The exact RequestInit passed to fetch by the code under test. */
  readonly init: RequestInit & { readonly duplex?: string }
  /** Lower-cased view of init.headers. */
  readonly headers: Readonly<Record<string, string>>
}

export type FetchHandler = (call: FetchCall) => Response | CannedReply | Promise<Response | CannedReply>
export type FetchRoute = CannedReply | FetchHandler | Sequence<CannedReply | FetchHandler>

export interface FetchStub {
  readonly calls: readonly FetchCall[]
  /** Calls for `METHOD https://…`, or for a full URL with any method. */
  callsTo(key: string): readonly FetchCall[]
}

function toResponse(reply: CannedReply): Response {
  const body = reply.body === undefined ? null : typeof reply.body === 'string' ? reply.body : new Uint8Array(reply.body)
  return new Response(body, { status: reply.status, headers: { ...reply.headers } })
}

/** Replaces global fetch for the current test (unstubGlobals restores it); unrouted URLs reject like a network error. */
export function stubFetch(routes: Readonly<Record<string, FetchRoute>>): FetchStub {
  const calls: FetchCall[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input)
    const method = (init.method ?? 'GET').toUpperCase()
    const call: FetchCall = { method, url, init, headers: Object.fromEntries(new Headers(init.headers).entries()) }
    calls.push(call)
    let route = routeFor(routes, method, url)
    if (isSequence<CannedReply | FetchHandler>(route)) route = route[SEQUENCE]()
    if (route === undefined) throw new TypeError(`Unexpected fetch ${method} ${url}`)
    const reply = isCanned(route) ? route : await route(call)
    return reply instanceof Response ? reply : toResponse(reply)
  }))
  return { calls, callsTo: key => calls.filter(call => matches(key, call.method, call.url)) }
}

/** Fully reads a streamed request body (e.g. a presigned PUT) as UTF-8. */
export async function bodyText(body: RequestInit['body']): Promise<string> {
  if (body === undefined || body === null) return ''
  return await new Response(body).text()
}
