import type { Context } from '@deepseek-ai/cordis';
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { ParseRequestInput } from './domain/request.js';
import { type OutputConfig } from './config/pure.js';
import type { StorageAccessGate } from './storage/access-gate.js';
import type { MinerUService, ResultView } from './service/mineru-service.js';
import { type DocumentSource } from './adapters/dsh-document-source.js';
declare module '@deepseek-ai/dsh-jobs' {
    interface JobKindMap {
        mineru: 'mineru';
    }
}
type ToolParseRequestInput = Omit<ParseRequestInput, 'file_path'> & DocumentSource;
export declare function parseAsyncInput(args: unknown): {
    readonly input: ToolParseRequestInput;
};
export interface ParsedToolInput {
    readonly input: ToolParseRequestInput;
    readonly pollTimeoutMs?: number;
    readonly inline_images?: boolean;
    readonly view?: 'page';
    readonly page?: number;
    readonly expected_sha256?: string;
}
export declare function parseReadInput(args: unknown): ParsedToolInput;
export declare function renderResult(value: ResultView): ContentBlock[];
export declare function registerTools(ctx: Context, getService: () => MinerUService, accessGate?: StorageAccessGate, getOutputConfig?: () => OutputConfig, getAttachments?: () => AttachmentStore | undefined): () => Promise<void>;
export {};
