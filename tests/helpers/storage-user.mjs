import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'

const root = process.argv[2]
if (!root) throw new Error('storage root required')
const host = createHash('sha256').update(hostname().toLowerCase()).digest('hex')
const ownerId = `u_${host}_${process.pid}_${randomUUID().replaceAll('-', '')}`
const ownerDir = join(root, '.lock', 'users', ownerId)
await mkdir(ownerDir, { mode: 0o700 })
process.stdout.write(ownerId + '\n')
const cleanup = async () => { await rm(ownerDir, { recursive: true, force: true }); process.exit(0) }
process.on('SIGTERM', () => { void cleanup() })
setInterval(() => undefined, 1000)
