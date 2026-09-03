# Changelog

## Unreleased

### Fixed

- Recover stale Windows `.process.lock` files safely after abnormal DSH exits using named pipe serialization and fail-closed PID liveness verification.

## 0.0.7

### Changed

- Set the minimum supported DeepSeek Harness baseline to `>=0.1.2-rc.1` and adopted an RC-only support policy, declaring compatibility exclusively for Release Candidate and stable releases of DSH while dropping legacy alpha testbed branches.
- Unified all `@deepseek-ai/dsh-*` devDependencies and peerDependencies to `^0.1.2-rc.1`, aligned Cordis packages (`@deepseek-ai/cordis@^4.0.2`, `cordis-plugin-include@^1.0.7`, `cordis-plugin-loader@^1.0.3`, `schemastery@^3.18.2`), and declared `engines.dsh: ">=0.1.2-rc.1"`.
- Removed the misleading `settings.plugin.item` branch in the browser client and standardized on a dedicated top-level `settings.section` for comprehensive Provider configuration, credential management, and storage maintenance.

### Added

- Added `isConcurrencySafe: () => true` to all model-facing tools (`mineru_health`, `mineru_parse_document`, and `mineru_submit_parse_job`) so parallel tool calls and multi-document parsing within a single turn can execute concurrently in the DSH agent loop without serial blocking.
- Added structured `output.presentationMeta` to `mineru_health`, `mineru_parse_document`, and `mineru_submit_parse_job` for clean session event metadata persistence and decoupled tool-card presentation.

### Fixed

- Enhanced existing-shell GUI verification script (`verify-current-gui.mjs`) with resilience against unhandled core shell errors during web test harness runs.

## 0.0.6

### Changed

- New installations now provision independent self-hosted v2 and official v4 Provider profiles, while existing single-Provider settings drafts are completed without overwriting their configured values.
- Expanded peer compatibility for the current DSH 0.1.2 alpha packages, Cordis 4.0.2, and Schemastery 3.18.2.

### Fixed

- Provider switching now changes only the active profile instead of destructively converting and resetting the current Provider configuration.
- Provider settings schemas now use literal type discriminants, preventing fields from leaking between self-hosted and official Provider records.
- Namespaced loopback RPC error codes and extended the existing-shell GUI verifier to cover lossless multi-Provider switching and current credential Remote payloads.

## 0.0.5

### Changed

- Aligned package exports, host/client TypeScript project references, `lib/types` declarations, tsdown faces, CSS Modules transformation, Node/pnpm constraints, and bundle/watch scripts with the DeepSeek Harness internal package conventions.
- Migrated the browser plugin to contribute through `settings.plugin.item`, with a compatibility fallback to `settings.section` for older Harness clients.

### Fixed

- Restored the MinerU settings page on the DSH 0.1.2 client architecture by removing obsolete/static client graph edges, using the Cordis client context, and registering the current Remote credentials dependency.
- Migrated API-key status and writes from the removed `connection.api.credentials` facade to `remote.credentials`.
- Updated the existing-shell GUI verifier for authenticated Web startup, versioned application batches, current combo URLs, and isolated redacted credential Remote mocks.
- Removed the obsolete BetterLocale bridge and the local facade for the deleted Client Runtime package.

## 0.0.4

### Added

- MinerU API keys can now be stored and managed through the DSH credentials service while configuration retains only credential references.

### Fixed

- Official v4 health checks now recognize MinerU's current `-60012` missing-task probe sentinel while continuing to reject unrelated business errors.
- Persisted user settings are resolved before the storage root is fixed, preserving Provider and parsing configuration across rebuilds, reinstalls, upgrades, and process reloads.
- Configuration saves can no longer report success after changing only in-memory state; every successful save now completes through the settings persistence scope.

## 0.0.3

### Changed

- Async parsing now registers native DSH `mineru-N` background jobs with owner isolation, completion delivery, `job_output`, and `job_kill`; plugin `mj_` session Jobs were removed.
- Synchronous parsing returns immutable results directly without creating a Job. `mineru_get_parse_status` and `mineru_get_parse_result` were removed in favor of generic DSH job controls.
- The default cache root is now `$DSH_HOME/cache/pdf-mineru`; existing `$DSH_HOME/dsh-pdf-mineru/v1` data is not migrated automatically.
- Shared operation shutdown now waits for background provider runners before the storage process lock is released.

### Added

- Multi-file document parsing support across tools and provider adapters.
- GitHub Actions workflow for automated npm publishing on tagged releases.
- Bounded, abort-aware retries for idempotent Provider GET operations and official presigned PUT uploads.
- Retry-After handling, exponential backoff with jitter, live retry settings, and typed structured diagnostics.
- An opt-in official v4 smoke command that executes the built `mineru_parse_document` tool chain.
- Loopback storage statistics, read-only integrity scanning, bounded quarantine management, and fail-closed GC preview.
- Storage operations in the settings UI with dry-run cleanup and explicit deletion confirmation.
- A preview-first, confirmation-gated cache clear operation that evicts all safely scanned published results while no SharedOperation or storage reader is active.

### Notes

- Published result inspection now has a strict non-mutating path and rejects symlinked or undeclared tree entries.
- The GUI verifier injects the current workspace bundle into an isolated existing-shell boot graph and covers desktop/mobile maintenance workflows.
- CSS module names always start with a valid identifier prefix.

### Security

- Official batch-allocation POST and self-hosted multipart POST are never automatically retried.
- Retry diagnostics no longer carry free-form upstream error strings, URLs, headers, bodies, credentials, or local paths.
- Quarantine isolation accepts only complete staging-operation or content-addressed result directories.
- Maintenance scans read manifests with bounded limits and no longer depend on plugin Job references.
- Destructive maintenance remains loopback-only and confirmation-gated. GC remains preview-only; explicit cache clearing fails closed for active SharedOperations, storage readers, incomplete scans, and unsafe result trees.

No canonical request, CacheKey, ProviderJobRef, or result manifest schema version changed.

## 0.0.1

- Initial npm release with provider-independent tools, self-hosted v2 and official v4 adapters, session Jobs, immutable global results, request coalescing, restart recovery, safe ZIP extraction, and Provider-aware settings.
