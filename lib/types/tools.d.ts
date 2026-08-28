/** Model-facing MinerU tools: health, native background submit, and direct parse. */
import type { Context } from 'cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-tools';
import type { StorageAccessGate } from './storage/access-gate.js';
import type { MinerUService, ParseDocumentView, ProbeView, ResultView } from './service/mineru-service.js';
declare module '@deepseek-ai/dsh-jobs' {
    interface JobKindMap {
        mineru: 'mineru';
    }
}
export declare function renderHealth(value: ProbeView): ContentBlock[];
export declare function renderResult(value: ResultView): ContentBlock[];
export declare function renderParseDocument(value: ParseDocumentView): ContentBlock[];
export declare function registerTools(ctx: Context, getService: () => MinerUService, accessGate?: StorageAccessGate): () => Promise<void>;
