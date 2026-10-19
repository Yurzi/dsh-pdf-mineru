export const name = 'dsh-pdf-mineru'
export const inject = ['tools', 'jobs', 'settings', 'workingDirectory']
export { Config } from './config/schema.js'
export { apply } from './plugin/lifecycle.js'

// Smoke seams: explicit offline entry points used by scripts/smoke-*.mjs.
export { defaultMinerUConfig, parseConfig } from './config/parse.js'
export { MINERU_RESULT_MANIFEST_SCHEMA_VERSION } from './domain/result.js'
export { parseMinerUResultManifest } from './domain/schemas.js'
export { ParseService } from './service/parse-service.js'
export { ReaderService } from './reader/reader-service.js'
export { formatResultProse } from './reader/prose.js'
export { parseReadArguments } from './tools/read-pdf.js'
