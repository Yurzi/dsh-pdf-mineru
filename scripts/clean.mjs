import { rm } from 'node:fs/promises'

await Promise.all([
  rm('lib/index.js', { force: true }),
  rm('lib/pdfjs-worker.mjs', { force: true }),
  rm('lib/client.js', { force: true }),
  rm('lib/client.js.map', { force: true }),
  rm('lib/types', { recursive: true, force: true }),
])
