import { copyFile, mkdir } from 'node:fs/promises'

// Keep the isolated ESM entry unbundled: its runtime imports and package resources
// must resolve from the installed plugin, never the caller's working directory.
await mkdir(new URL('../lib/', import.meta.url), { recursive: true })
await copyFile(new URL('../src/service/pdfjs-worker.mjs', import.meta.url), new URL('../lib/pdfjs-worker.mjs', import.meta.url))
