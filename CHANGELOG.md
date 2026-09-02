# Changelog

## Unreleased (s1lencewill fork)

### Fixed

- MinerU settings now appear as a default-collapsed plugin card, matching the marketplace style. Native keyboard-accessible disclosure keeps unsaved form edits mounted when collapsed; the legacy standalone settings page remains expanded.
- Settings fields stack on narrow screens instead of overflowing the expanded card horizontally.
- Windows can recover a `.process.lock` left by a terminated same-host process. A canonical-root named pipe serializes recovery and acquisition, and complete metadata is atomically published without overwriting a competing owner's file lock.
- Legacy live owners, reused live PIDs, foreign-host records, malformed metadata, and uncertain process probes remain fail-closed. Recovery never scans or deletes parsed results or staging data.
- Release removes owned metadata before relinquishing IPC authority, avoiding a hand-off race with the next owner.

### Tests

- Added settings-card tests for initial state, locale labels, draft preservation, saving, and legacy slot fallback, plus an isolated fixture preview (`node scripts/preview-settings.mjs`, optional `?lang=en&theme=dark`).
- Added real Windows child-process crash/restart and concurrent recovery tests, plus legacy-owner, cancellation, metadata-replacement, and path-alias coverage.
- Kept Linux abstract-socket-only tests platform-specific and added Windows/Linux CI checks.

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
