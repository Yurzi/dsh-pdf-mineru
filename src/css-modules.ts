import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve as resolvePath } from 'node:path'
import { transform } from 'lightningcss'

export const CLIENT_ID = 'dsh-pdf-mineru'
export const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

function styleInjectionModule(filename: string, cssText: string, classMap: Record<string, string>): string {
  const tagId = `${CLIENT_ID}/${basename(filename)}`
  return [
    `const css = ${JSON.stringify(cssText)};`,
    `const classMap = ${JSON.stringify(classMap)};`,
    `const tagId = ${JSON.stringify(tagId)};`,
    'if (typeof document !== "undefined") {',
    '  let tag = document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]");',
    '  if (tag === null) {',
    '    tag = document.createElement("style");',
    `    tag.dataset.plugin = ${JSON.stringify(CLIENT_ID)};`,
    '    tag.dataset.pluginCss = tagId;',
    '    document.head.appendChild(tag);',
    '  }',
    '  tag.textContent = css;',
    '}',
    'export default classMap;',
  ].join('\n')
}

export const cssModulesPlugin = {
  name: 'dsh-css-modules-inline',
  resolveId(source: string, importer: string | undefined) {
    if (!source.endsWith('.module.css')) return null
    const absolute = importer === undefined ? source : resolvePath(dirname(importer), source)
    return CSS_VIRTUAL_PREFIX + absolute + CSS_VIRTUAL_SUFFIX
  },
  async load(this: { addWatchFile(path: string): void }, virtualId: string) {
    if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
    const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
    this.addWatchFile(fileId)
    const source = await readFile(fileId)
    const { code, exports: cssExports } = transform({
      filename: fileId,
      code: source,
      cssModules: { pattern: 'dshm_[hash]_[local]' },
      minify: true,
    })
    const classMap: Record<string, string> = {}
    for (const [local, value] of Object.entries(cssExports ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
      classMap[local] = value.name
    }
    return styleInjectionModule(fileId, code.toString(), classMap)
  },
}
