/**
 * CSS modules and static shell slot props used by this package.
 * Host, Tool, and Connection contracts come from the published rc.2 dependencies.
 */

declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.css' {
  const classes: Record<string, string>
  export default classes
}

/** Static shell slot props used by the MinerU settings component. */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  export type PropsRuntime<K extends string = string> = { slotName?: K }
  export type PropsLocale<N extends string = string> = {
    t: (key: string, params?: Record<string, unknown>) => string
  }
}
