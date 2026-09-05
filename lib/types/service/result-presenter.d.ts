import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { MinerUFailure } from '../domain/errors.js';
import type { FocusKind } from '../domain/request.js';
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
    readonly page?: number;
}
export interface DocumentSummary {
    readonly page_count?: number;
    readonly table_count?: number;
    readonly image_count?: number;
    readonly equation_count?: number;
    readonly toc?: readonly DocumentHeading[];
}
export interface ImageCandidateView {
    readonly path: string;
    readonly name: string;
    readonly page?: number;
    readonly caption?: string;
    readonly media_type: string;
    readonly bytes: number;
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
    readonly ordered_images?: readonly ImageCandidateView[];
    readonly summary?: DocumentSummary;
    readonly toc?: readonly DocumentHeading[];
}
export interface FailedParseView {
    readonly state: 'failed';
    readonly source: SubmissionSource;
    readonly file_id: string;
    readonly name: string;
    readonly failure: MinerUFailure;
}
export type ParseDocumentView = ResultView;
export interface ContentListBlock {
    readonly type?: string;
    readonly page_idx?: number;
    readonly text?: string;
    readonly content?: string;
    readonly text_level?: number;
    readonly code?: string;
    readonly language?: string;
    readonly table_body?: string;
    readonly table_caption?: string | readonly string[];
    readonly table_footnote?: string | readonly string[];
    readonly img_path?: string;
    readonly image_path?: string;
    readonly path?: string;
    readonly image_caption?: string | readonly string[];
    readonly caption?: string | readonly string[];
    readonly image_footnote?: string | readonly string[];
    readonly footnote?: string | readonly string[];
    readonly [key: string]: unknown;
}
export declare function getBlockCategory(type?: string): 'text' | 'table' | 'image';
export declare function formatCaption(caption: unknown): string;
export declare function getRasterMediaType(ext: string): 'image/jpeg' | 'image/webp' | 'image/gif' | 'image/png';
export declare function computeDocumentSummary(contentList: readonly ContentListBlock[], fallbackFullText?: string): DocumentSummary;
export declare function extractBlocksMarkdown(contentList: readonly ContentListBlock[], pagesSet: ReadonlySet<number> | undefined, focusSet: ReadonlySet<FocusKind>, imageArtifacts: readonly ArtifactView[]): {
    text: string;
    orderedImages: ImageCandidateView[];
};
export declare function fallbackExtractFromMarkdown(fullMarkdownText: string, imageArtifacts: readonly ArtifactView[]): {
    text: string;
    orderedImages: ImageCandidateView[];
    summary: DocumentSummary;
};
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
export declare function formatSingleSummaryProse(value: ResultView): string;
export declare function formatParseSummaryProse(value: ParseDocumentView): string;
