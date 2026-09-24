import type { Context } from '@deepseek-ai/cordis';
import { type MineruKey } from './locales.js';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        'dsh-pdf-mineru': MineruKey;
    }
}
export declare const inject: string[];
export declare function apply(ctx: Context): void;
