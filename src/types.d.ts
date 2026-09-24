/**
 * CSS modules and static shell slot props used by this package.
 * Host, Tool, Connection and Client slot contracts come from DSH 0.1.7-rc.2.
 */

declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.css' {
  const classes: Record<string, string>
  export default classes
}
