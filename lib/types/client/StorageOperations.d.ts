import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client';
import type { MineruKey } from './locales.js';
export interface StorageOperationsProps {
    readonly rpc: ClientConnectionRpc;
    readonly t: (key: MineruKey) => string;
}
export declare function formatBytes(bytes: number, saturated?: boolean): string;
export declare function StorageOperations({ rpc, t }: StorageOperationsProps): import("react").JSX.Element;
