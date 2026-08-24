/**
 * job-repository.ts — Session-scoped persistent Job repository.
 *
 * Enforces:
 *   - Strict session isolation: session A cannot read or mutate session B's jobs
 *   - Atomic write semantics via temporary files and rename
 *   - State machine transition validation (assertJobTransition)
 *   - In-process serialized updates per jobId
 *   - Pinned schema validation on read and write
 */

import { randomUUID } from 'node:crypto'
import { mkdir, open, readdir, readFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { asJobId, asSessionId, type MinerUJobId, type SessionId } from '../domain/ids.js'
import { throwMinerU } from '../domain/errors.js'
import { assertJobTransition, type MinerUJobRecord } from '../domain/job.js'
import { parseMinerUJobRecord } from '../domain/schemas.js'
import { canonicalJson } from '../service/cache-key.js'
import type { StoragePaths } from './paths.js'

export interface SessionIdentifier {
  readonly header: { readonly id: SessionId | string }
}

export function extractSessionId(session: SessionIdentifier): SessionId {
  if (session !== null && typeof session === 'object' && 'header' in session
    && session.header !== null && typeof session.header === 'object' && 'id' in session.header) {
    return asSessionId(String(session.header.id))
  }
  throw new TypeError('invalid session identifier: an Agent-backed DSH Session is required')
}

class JobMutex {
  private readonly tails = new Map<string, Promise<void>>()

  async lock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve()
    let releaseCurrent!: () => void
    const next = new Promise<void>(resolve => {
      releaseCurrent = resolve
    })
    this.tails.set(key, next)

    try {
      await prev
      return await task()
    } finally {
      releaseCurrent()
      if (this.tails.get(key) === next) {
        this.tails.delete(key)
      }
    }
  }
}

export class JobRepository {
  private readonly mutex = new JobMutex()

  constructor(public readonly paths: StoragePaths) {}

  async create(session: SessionIdentifier, job: MinerUJobRecord): Promise<MinerUJobRecord> {
    const sessionId = extractSessionId(session)
    if (job.sessionId !== sessionId) {
      throwMinerU('JOB_ACCESS_DENIED', `Job sessionId "${job.sessionId}" does not match caller session "${sessionId}"`)
    }

    const validated = parseMinerUJobRecord(job)
    await this.atomicWrite(sessionId, validated.id, validated)
    return validated
  }

  async get(session: SessionIdentifier, jobId: MinerUJobId | string): Promise<MinerUJobRecord | undefined> {
    const sessionId = extractSessionId(session)
    const validJobId = asJobId(jobId)
    const filePath = this.paths.jobFile(sessionId, validJobId)

    let raw: string
    try {
      raw = await readFile(filePath, 'utf8')
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException
      if (nodeErr.code === 'ENOENT') {
        return undefined
      }
      throw err
    }

    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(raw)
    } catch {
      throwMinerU('CACHE_CORRUPT', `Job file "${filePath}" contains invalid JSON`)
    }

    const record = parseMinerUJobRecord(parsedJson)
    if (record.sessionId !== sessionId) {
      throwMinerU('JOB_ACCESS_DENIED', `Job "${validJobId}" does not belong to session "${sessionId}"`)
    }
    return record
  }

  async require(session: SessionIdentifier, jobId: MinerUJobId | string): Promise<MinerUJobRecord> {
    const record = await this.get(session, jobId)
    if (record === undefined) {
      const validJobId = asJobId(jobId)
      throwMinerU('JOB_NOT_FOUND', `MinerU job "${validJobId}" not found for session "${extractSessionId(session)}"`)
    }
    return record
  }

  async update(
    session: SessionIdentifier,
    jobId: MinerUJobId | string,
    mutator: (current: MinerUJobRecord) => MinerUJobRecord | Promise<MinerUJobRecord>,
  ): Promise<MinerUJobRecord> {
    const sessionId = extractSessionId(session)
    const validJobId = asJobId(jobId)
    const mutexKey = `${sessionId}:${validJobId}`

    return this.mutex.lock(mutexKey, async () => {
      const current = await this.require(session, validJobId)
      const next = await mutator(current)

      if (next.id !== current.id) {
        throw new TypeError(`Cannot change job ID in update: expected ${current.id}, got ${next.id}`)
      }
      if (next.sessionId !== current.sessionId) {
        throw new TypeError(`Cannot change job sessionId in update: expected ${current.sessionId}, got ${next.sessionId}`)
      }
      const immutableCurrent = {
        schemaVersion: current.schemaVersion,
        id: current.id,
        sessionId: current.sessionId,
        providerId: current.providerId,
        providerConfigId: current.providerConfigId,
        providerCompatibilityKey: current.providerCompatibilityKey,
        sourceFiles: current.sourceFiles,
        request: current.request,
        cacheKey: current.cacheKey,
        createdAt: current.createdAt,
      }
      const immutableNext = {
        schemaVersion: next.schemaVersion,
        id: next.id,
        sessionId: next.sessionId,
        providerId: next.providerId,
        providerConfigId: next.providerConfigId,
        providerCompatibilityKey: next.providerCompatibilityKey,
        sourceFiles: next.sourceFiles,
        request: next.request,
        cacheKey: next.cacheKey,
        createdAt: next.createdAt,
      }
      if (canonicalJson(immutableCurrent) !== canonicalJson(immutableNext)) {
        throw new TypeError('Cannot change immutable MinerU job metadata')
      }

      assertJobTransition(current.state, next.state)

      const withTimestamp: MinerUJobRecord = {
        ...next,
        updatedAt: Math.max(next.updatedAt, Date.now()),
      }

      const validated = parseMinerUJobRecord(withTimestamp)
      await this.atomicWrite(sessionId, validJobId, validated)
      return validated
    })
  }

  async list(session: SessionIdentifier): Promise<readonly MinerUJobRecord[]> {
    const sessionId = extractSessionId(session)
    const sessionDir = this.paths.jobDir(sessionId)

    let entries: string[]
    try {
      entries = await readdir(sessionDir)
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException
      if (nodeErr.code === 'ENOENT') return []
      throw err
    }

    const records: MinerUJobRecord[] = []
    for (const entry of entries) {
      if (!entry.startsWith('mj_') || !entry.endsWith('.json') || entry.includes('.tmp.')) {
        continue
      }
      const raw = await readFile(join(sessionDir, entry), 'utf8')
      try {
        const record = parseMinerUJobRecord(JSON.parse(raw))
        if (record.sessionId === sessionId) {
          records.push(record)
        }
      } catch {
        // Skip or ignore corrupt records in listing
      }
    }
    return records
  }

  private async atomicWrite(sessionId: SessionId, jobId: MinerUJobId, record: MinerUJobRecord): Promise<void> {
    const sessionDir = this.paths.jobDir(sessionId)
    await mkdir(sessionDir, { recursive: true })

    const token = randomUUID().replace(/-/g, '')
    const tempFile = this.paths.jobTempFile(sessionId, jobId, token)
    const finalFile = this.paths.jobFile(sessionId, jobId)
    const payload = JSON.stringify(record, null, 2)

    try {
      const handle = await open(tempFile, 'wx', 0o600)
      try {
        await handle.writeFile(payload, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(tempFile, finalFile)
      try {
        const directory = await open(sessionDir, 'r')
        try { await directory.sync() } finally { await directory.close() }
      } catch {
        // Directory fsync is unavailable on some platforms; rename remains atomic.
      }
    } catch (err) {
      try {
        await unlink(tempFile)
      } catch {
        // Ignore cleanup error
      }
      throw err
    }
  }
}
