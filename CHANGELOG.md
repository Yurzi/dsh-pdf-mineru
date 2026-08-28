# Changelog

## Unreleased

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
