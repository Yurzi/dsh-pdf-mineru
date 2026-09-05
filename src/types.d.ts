/**
 * types.d.ts — CSS modules and legacy Host-context declarations used by this package.
 *
 * DSH 0.1.2 Client packages are not published yet. The narrow, labelled Client
 * subsets below mirror the audited alpha source and deliberately omit removed facades.
 */

declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '@deepseek-ai/dsh-tools' {
  export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

  export type ContentBlock =
    | { type: 'text'; text: string }
    | { type: 'image'; attachment: import('@deepseek-ai/dsh-attachment').ImageAttachmentRef }

  export interface ValueSchemaAnnotations {
    description?: string
    title?: string
    default?: JsonValue
    examples?: JsonValue
  }

  export interface StringValueSchemaSpec extends ValueSchemaAnnotations {
    type: 'string'
    enum?: readonly string[]
    const?: string
  }

  export interface NumberValueSchemaSpec extends ValueSchemaAnnotations {
    type: 'number' | 'integer'
    enum?: readonly number[]
    const?: number
  }

  export interface BooleanValueSchemaSpec extends ValueSchemaAnnotations {
    type: 'boolean'
  }

  export interface NullValueSchemaSpec extends ValueSchemaAnnotations {
    type: 'null'
  }

  export interface ArrayValueSchemaSpec extends ValueSchemaAnnotations {
    type: 'array'
    items?: ValueSchemaSpec
  }

  export interface ObjectValueSchemaSpec extends ValueSchemaAnnotations {
    type: 'object'
    properties?: ParameterSchemaSpec
    additionalProperties: boolean
  }

  export interface JsonValueSchemaSpec extends ValueSchemaAnnotations {
    type: 'json'
  }

  export interface OneOfValueSchemaSpec extends ValueSchemaAnnotations {
    oneOf: readonly [ValueSchemaSpec, ValueSchemaSpec, ...ValueSchemaSpec[]]
  }

  export type ValueSchemaSpec =
    | StringValueSchemaSpec
    | NumberValueSchemaSpec
    | BooleanValueSchemaSpec
    | NullValueSchemaSpec
    | ArrayValueSchemaSpec
    | ObjectValueSchemaSpec
    | JsonValueSchemaSpec
    | OneOfValueSchemaSpec

  export type ParameterPropertySpec = ValueSchemaSpec & { required?: true }

  export type ParameterSchemaSpec = {
    [key: string]: ParameterPropertySpec
    [key: symbol]: never
  }

  type InferObject<S> =
    S extends { properties: infer P }
      ? S extends { additionalProperties: true }
        ? InferProps<P> & Record<string, JsonValue>
        : InferProps<P>
      : S extends { additionalProperties: true }
        ? Record<string, JsonValue>
        : Record<string, never>

  type InferProps<S> = S extends undefined
    ? Record<string, never>
    : {
        [K in Extract<keyof S, string> as S[K] extends { required: true } ? K : never]: InferValueAt<S[K]>
      } & {
        [K in Extract<keyof S, string> as S[K] extends { required: true } ? never : K]?: InferValueAt<S[K]>
      }

  type InferValueAt<S> =
    S extends { type: 'string' } ? string :
      S extends { type: 'number' | 'integer' } ? number :
        S extends { type: 'boolean' } ? boolean :
          S extends { type: 'null' } ? null :
            S extends { type: 'array' }
              ? S extends { items: infer I } ? InferValueAt<I>[] : JsonValue[]
              : S extends { type: 'object' } ? InferObject<S> :
                S extends { type: 'json' } ? JsonValue :
                  S extends { oneOf: readonly unknown[] } ? InferValueAt<S['oneOf'][number]> :
                    never

  export type InferArgs<S> = InferProps<S>

  export type InferValue<S> = InferValueAt<S>

  import type { Agent as RuntimeAgent } from '@deepseek-ai/dsh-agent'

  export type Agent = RuntimeAgent

  export interface ToolRunContext {
    readonly signal: AbortSignal
    readonly callId: string
    readonly name: string
    readonly arguments: unknown
    readonly agent?: Agent
  }

  export interface DefineToolOptions {
    readonly name: string
    readonly description: string
    readonly parameters: ParameterSchemaSpec
    readonly output: {
      readonly schema: ValueSchemaSpec
      render(args: unknown, value: unknown): ContentBlock[]
      presentationMeta?(args: unknown, value: unknown): JsonValue
    }
    readonly timeoutMs?: number
    isConcurrencySafe?(args: unknown): boolean
    execute(args: unknown, exec: ToolRunContext): Promise<unknown>
  }

  export function defineTool(options: DefineToolOptions): unknown
}

declare module 'cordis' {
  export interface Context {
    tools: {
      register(definition: unknown): () => void
      schemas(): readonly { name: string; description: string }[]
    }
    get(name: string): unknown
    effect(fn: () => unknown, label?: string): () => void
    on(event: string, listener: (...args: unknown[]) => unknown): () => void
    inject(services: readonly string[], callback: (ctx: Context) => void): void
    readonly logger: {
      info(...args: unknown[]): void
      warn(...args: unknown[]): void
      error(...args: unknown[]): void
      debug(...args: unknown[]): void
    }
    readonly connection?: {
      readonly rpc: {
        readonly handle: (
          channel: string,
          handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>,
          options: { readonly authority: 'trusted-host' | 'loopback' },
        ) => unknown
      }
    }
    readonly credentials?: {
      resolve?(ref: string): Promise<{ value: string } | undefined>
    }
    readonly settings?: {
      get?(key: string): unknown
      set?(key: string, value: unknown): Promise<void>
    }
    readonly slots?: {
      inject(slotName: string, factory: (ctx: Context) => unknown): void
      register(options: { name: string; id: string; order?: number; label: () => string; inject: () => unknown }, component: unknown): () => void
    }
    readonly locale?: {
      register(ns: string, dicts: Record<string, Record<string, string>>): () => void
      bind(ns: string): (key: string) => string
    }
  }
}

/** Host-side marker exported by the current Connection package. */
declare module '@deepseek-ai/dsh-client-connection' {
  export interface Connection {}
}

/** Current alpha Client carrier subset used while 0.1.2 packages are not yet published. */
declare module '@deepseek-ai/dsh-client-connection/client' {
  export interface ClientConnectionRpc {
    call<T = unknown>(channel: string, endpoint: string, payload?: unknown): Promise<RpcResult<T>>
    call<T = unknown>(endpoint: string, payload?: unknown): Promise<RpcResult<T>>
  }
  export type RpcResult<T> =
    | { ok: true; value: T }
    | { ok: false; error: { code?: string; message: string; details?: unknown } }
  export interface ConnectionHandle {
    readonly rpc: ClientConnectionRpc
  }
}

/** Static shell slot props used by the MinerU settings component. */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  export type PropsRuntime<K extends string = string> = { slotName?: K }
  export type PropsLocale<N extends string = string> = {
    t: (key: string, params?: Record<string, unknown>) => string
  }
}
