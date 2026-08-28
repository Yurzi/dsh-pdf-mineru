/**
 * job-repository.ts - In-memory Job store scoped to live DSH sessions.
 *
 * Jobs are intentionally not durable. The live DSH session owns their lifetime;
 * the plugin removes a session's records when the host emits session/disposed.
 * The repository still validates every boundary and serializes per-job updates.
 */
import { type MinerUJobId, type SessionId } from '../domain/ids.js';
import { type MinerUJobRecord } from '../domain/job.js';
export interface SessionIdentifier {
    readonly header: {
        readonly id: SessionId | string;
    };
}
export declare function extractSessionId(session: SessionIdentifier): SessionId;
export declare class JobRepository {
    private readonly mutex;
    private readonly closedSessions;
    private readonly sessions;
    create(session: SessionIdentifier, job: MinerUJobRecord): Promise<MinerUJobRecord>;
    get(session: SessionIdentifier, jobId: MinerUJobId | string): Promise<MinerUJobRecord | undefined>;
    require(session: SessionIdentifier, jobId: MinerUJobId | string): Promise<MinerUJobRecord>;
    update(session: SessionIdentifier, jobId: MinerUJobId | string, mutator: (current: MinerUJobRecord) => MinerUJobRecord | Promise<MinerUJobRecord>): Promise<MinerUJobRecord>;
    list(session: SessionIdentifier): Promise<readonly MinerUJobRecord[]>;
    /** Snapshot for privileged cache maintenance; no session boundary is exposed. */
    snapshot(): readonly MinerUJobRecord[];
    /** Drop all records when the host disposes a live DSH session. */
    deleteSession(session: SessionIdentifier): number;
    /** Remove jobs whose cache-backed result was successfully evicted. */
    deleteByCacheKeys(cacheKeys: ReadonlySet<string>): number;
}
