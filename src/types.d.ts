/** CSS modules are compiled by build/css-modules.ts into injected class maps. */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
