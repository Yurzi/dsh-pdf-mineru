import type { AttachmentStore } from '@deepseek-ai/dsh-attachment';
import type { Message } from '@deepseek-ai/dsh-llm';
/** Tool-only selectors. Attachment identities never enter the MinerU domain. */
export type DocumentSource = {
    readonly file_path: string;
    readonly attachment_id?: never;
} | {
    readonly attachment_id: string;
    readonly file_path?: never;
};
export declare function parseDocumentSource(args: Readonly<Record<string, unknown>>): DocumentSource;
/** Resolve only references on the current DSH surface; never scan raw history or storage. */
export declare function resolveDocumentPath(source: DocumentSource, session: {
    deriveMessages(): readonly Message[];
}, attachments: Pick<AttachmentStore, 'fileHostPath'> | undefined): string;
