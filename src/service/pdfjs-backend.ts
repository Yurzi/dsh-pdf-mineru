import { fileURLToPath } from 'node:url'

const PDFJS_WORKER_URL = new URL('./pdfjs-worker.mjs', import.meta.url)
const PDFJS_MAX_OLD_SPACE_MIB = 512
const MAX_PAGE_NUMBER = 1_000_000

function positiveInteger(value: number, name: string, maximum = Number.MAX_SAFE_INTEGER): string {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(name + ' must be a positive safe integer')
  }
  return String(value)
}

function pathArgument(value: string, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new TypeError(name + ' must be a non-empty path')
  }
  return value
}

/**
 * Build fixed Node arguments for the local PDF.js renderer. The final four
 * arguments are the worker protocol: snapshot, output, page, and byte limit.
 */
export function buildPdfjsArgs(
  snapshotPath: string,
  outputPath: string,
  page: number,
  maxFileBytes: number,
): string[] {
  return [
    '--max-old-space-size=' + String(PDFJS_MAX_OLD_SPACE_MIB),
    '--disallow-code-generation-from-strings',
    '--no-warnings',
    fileURLToPath(PDFJS_WORKER_URL),
    pathArgument(snapshotPath, 'snapshotPath'),
    pathArgument(outputPath, 'outputPath'),
    positiveInteger(page, 'page', MAX_PAGE_NUMBER),
    positiveInteger(maxFileBytes, 'maxFileBytes'),
  ]
}
