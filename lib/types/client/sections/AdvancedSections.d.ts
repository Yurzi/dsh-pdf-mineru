import type { Dispatch, SetStateAction } from 'react';
import { type MinerUConfig } from '../../config/pure.js';
import type { MineruKey } from '../locales.js';
export interface AdvancedSectionsProps {
    readonly draft: MinerUConfig;
    readonly setDraft: Dispatch<SetStateAction<MinerUConfig | null>>;
    readonly cardsOpen: Record<string, boolean>;
    readonly onToggleCard: (cardId: string) => void;
    readonly t: (key: MineruKey) => string;
}
export declare function AdvancedSections({ draft, setDraft, cardsOpen, onToggleCard, t, }: AdvancedSectionsProps): import("react").JSX.Element;
