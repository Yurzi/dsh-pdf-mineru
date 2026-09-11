import type { ContentListBlock } from '../service/result-presenter.js';
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
 * Add stable document identities and faithfully expose known MinerU nested text.
 * The input array and its blocks are never mutated.
 */
export declare function normalizeDocumentBlocks(contentList: readonly ContentListBlock[], resultId: string, warningBlockOrders?: ReadonlySet<number>): {
    blocks: readonly IndexedContentBlock[];
    warnings: readonly string[];
};
