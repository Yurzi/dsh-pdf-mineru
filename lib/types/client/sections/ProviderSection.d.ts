import type { Dispatch, SetStateAction } from 'react';
import type { MinerUConfig, ProviderConfig } from '../../config/pure.js';
import type { MineruKey } from '../locales.js';
import type { CredentialView } from '../helpers.js';
export interface ProviderSectionProps {
    readonly draft: MinerUConfig;
    readonly setDraft: Dispatch<SetStateAction<MinerUConfig | null>>;
    readonly activeProvider: ProviderConfig;
    readonly activeCredentialRef: string | undefined;
    readonly apiKeyDraft: string;
    readonly setApiKeyDraft: (value: string) => void;
    readonly credentialStateReady: boolean;
    readonly credentialView?: CredentialView;
    readonly credentialLocked: boolean;
    readonly credentialInputDisabled: boolean;
    readonly credentialPlaceholder: string;
    readonly credentialBusy: boolean;
    readonly credentialStatus: 'unavailable' | 'loading' | 'ready' | 'error';
    readonly credentialError?: string;
    readonly onClearCredential: () => void;
    readonly onActivateProvider: (providerId: string) => void;
    readonly t: (key: MineruKey) => string;
}
export declare function ProviderSection({ draft, setDraft, activeProvider, activeCredentialRef, apiKeyDraft, setApiKeyDraft, credentialStateReady, credentialView, credentialLocked, credentialInputDisabled, credentialPlaceholder, credentialBusy, credentialStatus, credentialError, onClearCredential, onActivateProvider, t, }: ProviderSectionProps): import("react").JSX.Element;
