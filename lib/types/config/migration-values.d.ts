import { type MinerUConfig, type ProviderConfig } from './pure.js';
/** Repairs values only while loading known historical versions. It never persists or resolves credentials. */
export declare function repairLegacyConfigValues(input: Record<string, unknown>, fallback: MinerUConfig, parseProvider: (value: unknown) => ProviderConfig, parseCanonical: (value: Record<string, unknown>, fallback: MinerUConfig) => MinerUConfig): {
    input: Record<string, unknown>;
    defaultedFields: readonly string[];
};
