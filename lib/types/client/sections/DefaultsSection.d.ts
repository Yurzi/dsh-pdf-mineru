import type { Dispatch, SetStateAction } from 'react';
import type { MinerUConfig, ProviderConfig } from '../../config/pure.js';
import type { MineruKey } from '../locales.js';
export interface DefaultsSectionProps {
    readonly draft: MinerUConfig;
    readonly setDraft: Dispatch<SetStateAction<MinerUConfig | null>>;
    readonly activeProvider: ProviderConfig;
    readonly txtToAutoNotice: boolean;
    readonly onDismissTxtNotice: () => void;
    readonly t: (key: MineruKey) => string;
}
export declare function DefaultsSection({ draft, setDraft, activeProvider, txtToAutoNotice, onDismissTxtNotice, t, }: DefaultsSectionProps): import("react").JSX.Element;
