import { type MinerUConfig, type SelfHostedLegacyV2Config } from './config/pure.js';
export * from './config/pure.js';
export declare function defaultMinerUConfig(): MinerUConfig;
export interface SelfHostedProviderMigration {
    readonly providerId: SelfHostedLegacyV2Config['id'];
    readonly from: 'self-hosted-v2';
    readonly to: 'self-hosted-legacy-v2';
    /** V1-only fields removed when an old mixed profile is explicitly migrated to legacy. */
    readonly removedFields: readonly 'tier'[];
}
export interface ConfigMigrationStep {
    readonly from: number;
    readonly to: number;
}
export interface ParsedMinerUConfig {
    readonly config: MinerUConfig;
    readonly migrated: boolean;
    readonly migratedFrom?: 1 | 2;
    /** Versionless Provider-based documents predate schema 3 and are interpreted as schema 2. */
    readonly assumedVersion?: 2;
    readonly migrationSteps?: readonly ConfigMigrationStep[];
    /** Paths only: never record old values, credentials, endpoints or filesystem paths. */
    readonly defaultedFields?: readonly string[];
    readonly providerMigrations?: readonly SelfHostedProviderMigration[];
}
/** Parse startup/settings input, including known field and self-hosted profile migrations. */
export declare function parseConfigWithMigration(value: unknown): ParsedMinerUConfig;
/** Strict canonical parser for current-version edits; loading historical documents uses the migration entry point. */
export declare function parseConfig(value: unknown): MinerUConfig;
export declare function pruneConfigToDiff(next: MinerUConfig, base?: MinerUConfig): Record<string, unknown>;
export declare function detectBloatedSettingsOps(userSection: Record<string, unknown>, base?: MinerUConfig): Array<{
    op: 'unset';
    path: string[];
}>;
