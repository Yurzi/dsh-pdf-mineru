import type { Context as CordisContext } from '@deepseek-ai/cordis';
import { type CredentialClient } from './SettingsPage.js';
import { type MineruKey } from './locales.js';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        'dsh-pdf-mineru': MineruKey;
    }
}
type SlotOptions = {
    name: string;
    id: string;
    order?: number;
    label?: () => string;
    locale?: string;
    inject: () => unknown;
};
type ClientContext = CordisContext & {
    readonly locale: {
        register(ns: string, dictionaries: Record<string, Record<string, string>>): () => void;
        bind(ns: string): (key: MineruKey) => string;
    };
    readonly slots: {
        inject(slotName: string, factory: () => unknown): void;
        register(options: SlotOptions, component: unknown): () => void;
    };
    readonly remote: {
        readonly credentials: CredentialClient;
    };
};
export declare const inject: string[];
export declare function apply(ctx: ClientContext): void;
export {};
