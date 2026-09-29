import type { Context } from '@deepseek-ai/cordis';
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection';
/**
 * Retain channel-local loopback policy on 0.2.0-rc.1, whose native rpc.handle no longer
 * accepts an authority option. Only this caller's route registration is wrapped;
 * the real Connection still owns authentication, envelopes, and cancellation.
 */
export declare function registerLoopbackRpc(ctx: Context, channel: string, handler: ConnectionRpcHandler): () => Promise<void>;
