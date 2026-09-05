import type { Context } from 'cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-tools';
import type { ParseRequestInput } from './domain/request.js';
import type { StorageAccessGate } from './storage/access-gate.js';
import type { MinerUService, ParseDocumentView, ResultView } from './service/mineru-service.js';
declare module '@deepseek-ai/dsh-jobs' {
    interface JobKindMap {
        mineru: 'mineru';
    }
}
export interface ParsedToolInput {
    readonly input: ParseRequestInput;
    readonly pollTimeoutMs?: number;
    readonly inline_images?: boolean;
    readonly max_inline_images?: number;
}
export declare function renderResult(value: ResultView): ContentBlock[];
export declare function renderParseDocument(value: ParseDocumentView): ContentBlock[];
export declare function registerTools(ctx: Context, getService: () => MinerUService, accessGate?: StorageAccessGate): () => Promise<void>;
