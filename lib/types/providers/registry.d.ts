import type { ProviderConfigId } from '../domain/ids.js';
import type { MinerUConfig, ProviderConfig } from '../config.js';
import type { MinerUProvider, ProviderOptions } from './provider.js';
export interface ResolvedProvider {
    readonly provider: MinerUProvider;
    readonly config: ProviderConfig;
}
export declare class ProviderRegistry {
    private readonly getConfig;
    private readonly options?;
    constructor(getConfig: () => MinerUConfig, options?: ProviderOptions | undefined);
    active(): ResolvedProvider;
    resolve(configId: ProviderConfigId): ResolvedProvider;
    create(config: ProviderConfig): MinerUProvider;
}
