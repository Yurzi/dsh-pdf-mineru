import type { Dispatch, SetStateAction } from 'react';
import type { MinerUConfig } from '../../config/pure.js';
import type { MineruKey } from '../locales.js';
export interface AdvancedSectionsProps {
    readonly draft: MinerUConfig;
    readonly setDraft: Dispatch<SetStateAction<MinerUConfig | null>>;
    readonly t: (key: MineruKey) => string;
}
export declare function AdvancedSections({ draft, setDraft, t, }: AdvancedSectionsProps): import("react").JSX.Element;
