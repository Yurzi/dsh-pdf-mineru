# Changelog

## 0.0.2

### Added

- Multi-file document parsing support across tools and provider adapters.
- GitHub Actions workflow for automated npm publishing on tagged releases.
- Bounded, abort-aware retries for idempotent Provider GET operations and official presigned PUT uploads.
- Retry-After handling, exponential backoff with jitter, live retry settings, and typed structured diagnostics.
- An opt-in official v4 smoke command that executes the built `mineru_parse_document` tool chain.
- Loopback storage statistics, read-only integrity scanning, bounded quarantine management, and fail-closed GC preview.
- Storage operations in the settings UI with dry-run cleanup and explicit deletion confirmation.
- A preview-first, confirmation-gated cache clear operation that evicts all safely scanned published results while retaining Job records.

### Changed

- Published result inspection now has a strict non-mutating path and rejects symlinked or undeclared tree entries.
- The GUI verifier injects the current workspace bundle into an isolated existing-shell boot graph and covers desktop/mobile maintenance workflows.
- CSS module names always start with a valid identifier prefix.

### Security

- Official batch-allocation POST and self-hosted multipart POST are never automatically retried.
- Retry diagnostics no longer carry free-form upstream error strings, URLs, headers, bodies, credentials, or local paths.
- Quarantine isolation accepts only complete staging-operation or content-addressed result directories.
- Maintenance scans read manifests and persisted Jobs through explicit streaming byte limits.
- Destructive maintenance remains loopback-only and confirmation-gated. GC remains preview-only; explicit cache clearing fails closed for active Jobs, incomplete scans, and unsafe result trees.

No Job, canonical request, CacheKey, ProviderJobRef, or result manifest schema version changed.

## 0.0.1

- Initial npm release with provider-independent tools, self-hosted v2 and official v4 adapters, session Jobs, immutable global results, request coalescing, restart recovery, safe ZIP extraction, and Provider-aware settings.
