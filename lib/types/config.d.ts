import { type MinerUConfig } from './config/pure.js';
export * from './config/pure.js';
export declare function defaultMinerUConfig(): MinerUConfig;
export interface ParsedMinerUConfig {
    readonly config: MinerUConfig;
    readonly migrated: boolean;
    readonly migratedFrom?: 1;
}
/** Parse startup/settings input, including legacy fields merged over a current composition base. */
export declare function parseConfigWithMigration(value: unknown): ParsedMinerUConfig;
export declare function parseConfig(value: unknown): MinerUConfig;
