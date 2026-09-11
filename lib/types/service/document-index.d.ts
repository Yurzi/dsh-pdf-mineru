import type { ContentListBlock } from '../service/result-presenter.js';
/** Version of the provider-content projection semantics. */
export declare const DOCUMENT_INDEX_VERSION: 2;
/** A bounded, block-scoped diagnostic suitable for chunk delivery. */
export interface BlockDiagnostic {
    readonly id: string;
    readonly code: string;
    readonly scope: 'chunk';
    readonly message: string;
    readonly block_id: string;
    readonly page?: number;
}
/** A content-list block with an identity fixed before page/focus selection. */
export interface IndexedContentBlock extends ContentListBlock {
    readonly block_id: string;
    readonly document_label?: string;
    /** One-based position in the provider's original content-list. */
    readonly document_order: number;
}
/**
 * Extract an author/provider supplied figure, table, or equation label.
 *
 * Only a label at the beginning of a relevant caption is accepted. This
 * deliberately does not synthesize labels from the block's return position.
 */
export declare function extractDocumentLabel(block: ContentListBlock): string | undefined;
/**
 * Add stable document identities and faithfully expose known MinerU content.
 * The input array and its blocks are never mutated.
 */
export declare function normalizeDocumentBlocks(contentList: readonly ContentListBlock[], resultId: string, warningBlockOrders?: ReadonlySet<number>): {
    blocks: readonly IndexedContentBlock[];
    warnings: readonly string[];
};
/** Diagnose only selected one-based original-order blocks without renumbering. */
export declare function collectBlockDiagnostics(contentList: readonly ContentListBlock[], resultId: string, orders: ReadonlySet<number>): readonly BlockDiagnostic[];
