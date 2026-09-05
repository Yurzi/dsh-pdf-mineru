import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { MinerUFailure } from '../domain/errors.js';
export type SubmissionSource = 'cache' | 'shared-operation' | 'provider';
export type ContentStatus = 'complete' | 'partial' | 'not_requested';
export interface ArtifactView {
    readonly kind: string;
    readonly path: string;
    readonly bytes: number;
}
export interface ResultFileView {
    readonly file_id: string;
    readonly name: string;
    readonly artifacts: readonly ArtifactView[];
    readonly artifacts_truncated?: boolean;
    readonly markdown_path?: string;
}
export interface DocumentHeading {
    readonly level: number;
    readonly title: string;
    readonly line: number;
}
export interface InlinedImageView {
    readonly attachment_id: string;
    readonly name: string;
    readonly media_type: string;
    readonly width?: number;
    readonly height?: number;
    readonly bytes?: number;
    readonly attachmentRef?: ImageAttachmentRef;
}
export interface ResultView {
    readonly state: 'completed';
    readonly source: SubmissionSource;
    readonly cache_hit: boolean;
    readonly result_id: string;
    readonly files: readonly ResultFileView[];
    readonly markdown_content?: string;
    readonly content_status: ContentStatus;
    readonly markdown_path?: string;
    readonly read_offset_line?: number;
    readonly manifest_path: string;
    readonly output_limit_chars: number;
    readonly inlined_images?: readonly InlinedImageView[];
    readonly toc?: readonly DocumentHeading[];
}
export interface FailedParseView {
    readonly state: 'failed';
    readonly source: SubmissionSource;
    readonly file_id: string;
    readonly name: string;
    readonly failure: MinerUFailure;
}
export interface BatchParseDocumentView {
    readonly kind: 'batch';
    readonly state: 'completed' | 'partially-completed' | 'failed';
    readonly results: readonly (ResultView | FailedParseView)[];
    readonly output_limit_chars: number;
    readonly content_status?: ContentStatus;
    readonly results_omitted?: boolean;
}
export type ParseDocumentView = ResultView | BatchParseDocumentView;
export declare function safeStringSlice(str: string, maxLen: number): string;
export declare function truncateAtCleanBoundary(fullText: string, maxChars: number): {
    text: string;
    truncated: boolean;
    resumeLine?: number;
};
export declare function allocateReclaimedShares(lengths: readonly number[], totalBudget: number): number[];
export declare function readMarkdownFile(path: string, totalBytes: number, maxCharsToRead: number): Promise<{
    text: string;
    isCompleteFile: boolean;
}>;
export declare function findMarkdownArtifactPath(value: ResultView): string | undefined;
export declare function extractMarkdownHeadings(fullText: string): DocumentHeading[];
export declare function formatResultProse(value: ResultView): string;
export declare function formatParseDocumentProse(value: ParseDocumentView): string;
