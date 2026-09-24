import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'

interface HttpRoute {
  readonly kind: string
  readonly path: string
  readonly handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
}

interface RouteRegistrar {
  register(route: HttpRoute): () => void | Promise<void>
}

/** Accept only a bare loopback Host authority, never URL parts or trusted LAN names. */
function isLoopbackAuthority(host: string | string[] | undefined): boolean {
  if (typeof host !== 'string') return false
  const match = /^(localhost|127(?:\.[0-9]{1,3}){3}|\[::1\])(?::([0-9]{1,5}))?$/i.exec(host)
  if (match === null || match[0] !== host || (match[2] !== undefined && Number(match[2]) > 65535)) return false
  return !match[1]!.startsWith('127.') || match[1]!.split('.').every(part => Number(part) <= 255)
}

/**
 * Retain channel-local loopback policy on 0.1.7-rc.2, whose native rpc.handle no longer
 * accepts an authority option. Only this caller's route registration is wrapped;
 * the real Connection still owns authentication, envelopes, and cancellation.
 */
export function registerLoopbackRpc(ctx: Context, channel: string, handler: ConnectionRpcHandler): () => Promise<void> {
  // Read through the injected service before extending the caller. Cordis 4's
  // service getter shadows dependency lookup to the Connection provider, which
  // need not inject webServer on 0.1.7-rc.2. A local Context metadata override makes
  // the narrow registrar visible there without changing any global service.
  const webServer = (ctx as Context & { webServer: RouteRegistrar }).webServer
  const scoped = ctx.extend({
    webServer: {
      register(route: HttpRoute) {
        return webServer.register({
          ...route,
          handler(request, response) {
            if (!isLoopbackAuthority(request.headers.host)) {
              response.writeHead(403)
              response.end('forbidden')
              return
            }
            return route.handler(request, response)
          },
        })
      },
    } satisfies RouteRegistrar,
  })
  return scoped.connection.rpc.handle(channel, handler)
}
