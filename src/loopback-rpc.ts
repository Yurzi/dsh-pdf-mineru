import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

/** Accept only a bare loopback Host authority, never URL parts or trusted LAN names. */
function isLoopbackAuthority(host: string | string[] | undefined): boolean {
  if (typeof host !== 'string') return false
  const match = /^(localhost|127(?:\.[0-9]{1,3}){3}|\[::1\])(?::([0-9]{1,5}))?$/i.exec(host)
  if (match === null || match[0] !== host || (match[2] !== undefined && Number(match[2]) > 65535)) return false
  return !match[1]!.startsWith('127.') || match[1]!.split('.').every(part => Number(part) <= 255)
}

/** Guard this caller’s Host authority; Connection owns authentication and transport. */
export function registerLoopbackRpc(ctx: Context, channel: string, handler: ConnectionRpcHandler): () => Promise<void> {
  // Capture before extending: service lookup shadows the caller’s dependencies.
  const webServer = ctx.webServer
  const scoped = ctx.extend({
    webServer: {
      register(route: WebRoute) {
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
    } satisfies Pick<Context['webServer'], 'register'>,
  })
  return scoped.connection.rpc.handle(channel, handler)
}
