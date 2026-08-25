/**
 * job-repository.ts - In-memory Job store scoped to live DSH sessions.
 *
 * Jobs are intentionally not durable. The live DSH session owns their lifetime;
 * the plugin removes a session's records when the host emits session/disposed.
 * The repository still validates every boundary and serializes per-job updates.
 */

import { asJobId, asSessionId, type MinerUJobId, type SessionId } from '../domain/ids.js'
import { throwMinerU } from '../domain/errors.js'
import { assertJobTransition, type MinerUJobRecord } from '../domain/job.js'
import { parseMinerUJobRecord } from '../domain/schemas.js'
import { canonicalJson } from '../service/cache-key.js'

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
    const next = new Promise<void>(resolve => { releaseCurrent = resolve })
    this.tails.set(key, next)
    try {
      await prev
      return await task()
    } finally {
      releaseCurrent()
      if (this.tails.get(key) === next) this.tails.delete(key)
    }
  }
}

function cloneJob(job: MinerUJobRecord): MinerUJobRecord {
  return parseMinerUJobRecord(structuredClone(job))
}

function referencesCacheKey(job: MinerUJobRecord, cacheKeys: ReadonlySet<string>): boolean {
  return cacheKeys.has(job.cacheKey) || job.files.some(file => cacheKeys.has(file.cacheKey))
}

export class JobRepository {
  private readonly mutex = new JobMutex()
  private readonly closedSessions = new WeakSet<object>()
  private readonly sessions = new Map<SessionId, Map<MinerUJobId, MinerUJobRecord>>()

  async create(session: SessionIdentifier, job: MinerUJobRecord): Promise<MinerUJobRecord> {
    const sessionId = extractSessionId(session)
    if (this.closedSessions.has(session)) {
      throwMinerU('JOB_NOT_FOUND', 'MinerU session "' + sessionId + '" is no longer live')
    }
    if (job.sessionId !== sessionId) {
      throwMinerU('JOB_ACCESS_DENIED', 'Job sessionId "' + job.sessionId + '" does not match caller session "' + sessionId + '"')
    }
    const validated = parseMinerUJobRecord(job)
    if (validated.request.files.length !== 1 || validated.sourceFiles.length !== 1 || validated.files.length !== 1) {
      throw new TypeError('New MinerU jobs must contain exactly one file')
    }
    let records = this.sessions.get(sessionId)
    if (records === undefined) {
      records = new Map()
      this.sessions.set(sessionId, records)
    }
    if (records.has(validated.id)) throw new TypeError('MinerU job "' + validated.id + '" already exists in this session')
    const stored = cloneJob(validated)
    records.set(stored.id, stored)
    return cloneJob(stored)
  }

  async get(session: SessionIdentifier, jobId: MinerUJobId | string): Promise<MinerUJobRecord | undefined> {
    const sessionId = extractSessionId(session)
    const record = this.sessions.get(sessionId)?.get(asJobId(jobId))
    return record === undefined ? undefined : cloneJob(record)
  }

  async require(session: SessionIdentifier, jobId: MinerUJobId | string): Promise<MinerUJobRecord> {
    const record = await this.get(session, jobId)
    if (record === undefined) {
      const validJobId = asJobId(jobId)
      throwMinerU('JOB_NOT_FOUND', 'MinerU job "' + validJobId + '" not found for session "' + extractSessionId(session) + '"')
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
    return this.mutex.lock(sessionId + ':' + validJobId, async () => {
      const current = await this.require(session, validJobId)
      const next = await mutator(current)
      if (next.id !== current.id) throw new TypeError('Cannot change job ID in update: expected ' + current.id + ', got ' + next.id)
      if (next.sessionId !== current.sessionId) throw new TypeError('Cannot change job sessionId in update: expected ' + current.sessionId + ', got ' + next.sessionId)
      const immutableCurrent = {
        schemaVersion: current.schemaVersion, id: current.id, sessionId: current.sessionId,
        providerId: current.providerId, providerConfigId: current.providerConfigId,
        providerCompatibilityKey: current.providerCompatibilityKey, sourceFiles: current.sourceFiles,
        request: current.request, cacheKey: current.cacheKey, createdAt: current.createdAt,
      }
      const immutableNext = {
        schemaVersion: next.schemaVersion, id: next.id, sessionId: next.sessionId,
        providerId: next.providerId, providerConfigId: next.providerConfigId,
        providerCompatibilityKey: next.providerCompatibilityKey, sourceFiles: next.sourceFiles,
        request: next.request, cacheKey: next.cacheKey, createdAt: next.createdAt,
      }
      if (canonicalJson(immutableCurrent) !== canonicalJson(immutableNext)) throw new TypeError('Cannot change immutable MinerU job metadata')
      assertJobTransition(current.state, next.state)
      const records = this.sessions.get(sessionId)
      if (records === undefined || !records.has(validJobId)) {
        throwMinerU('JOB_NOT_FOUND', 'MinerU job "' + validJobId + '" is no longer attached to session "' + sessionId + '"')
      }
      const validated = parseMinerUJobRecord({ ...next, updatedAt: Math.max(next.updatedAt, Date.now()) })
      records.set(validated.id, cloneJob(validated))
      return cloneJob(validated)
    })
  }

  async list(session: SessionIdentifier): Promise<readonly MinerUJobRecord[]> {
    const sessionId = extractSessionId(session)
    return [...(this.sessions.get(sessionId)?.values() ?? [])].map(cloneJob)
  }

  /** Snapshot for privileged cache maintenance; no session boundary is exposed. */
  snapshot(): readonly MinerUJobRecord[] {
    return [...this.sessions.values()].flatMap(records => [...records.values()].map(cloneJob))
  }

  /** Drop all records when the host disposes a live DSH session. */
  deleteSession(session: SessionIdentifier): number {
    const sessionId = extractSessionId(session)
    this.closedSessions.add(session)
    const records = this.sessions.get(sessionId)
    if (records === undefined) return 0
    this.sessions.delete(sessionId)
    return records.size
  }

  /** Remove jobs whose cache-backed result was successfully evicted. */
  deleteByCacheKeys(cacheKeys: ReadonlySet<string>): number {
    let deleted = 0
    for (const [sessionId, records] of this.sessions) {
      for (const [jobId, job] of records) {
        if (!referencesCacheKey(job, cacheKeys)) continue
        records.delete(jobId)
        deleted++
      }
      if (records.size === 0) this.sessions.delete(sessionId)
    }
    return deleted
  }
}
