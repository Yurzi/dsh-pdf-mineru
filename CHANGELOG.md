# Changelog

## 0.1.3

### Changed

- Require DSH >= 0.1.7-rc.2 in engines and runtime peers; pin development SDK packages and workspace release-age exclusions to DSH 0.1.7-rc.2.
- Align integration tests, package manifests, and loopback RPC comments with DSH 0.1.7-rc.2.

Provider/config/cache formats, cursor v3, index v2, native jobs, and plugin configuration UI are unchanged; existing parsed caches require no migration.

## 0.1.2

### Added

- Report bounded, invocation-local parse phases through the native JobHandle progress surface, with a 48,000-byte model job output limit. Cache hits skip the waiting phase; progress never includes provider refs or sensitive request data.
- Add integration regressions against the published 0.1.7-rc.1 LocalJobRegistry for owner isolation, controller admission, consume-once final results, progress and kill/owner/plugin teardown, plus TypeScript/Python PTC schema projections.
- Add GUI boot diagnostics and an explicit browser-fixture-only unrelated-plugin exclusion option without changing the running host profile.

### Changed

- Move the custom MinerU configuration page from the global Settings navigation to its Plugins bundle detail via the public `plugins.bundle.config` slot keyed by `dsh-pdf-mineru`. Preserve draft state, explicit saves, credential handling and maintenance confirmations; align client dependencies and GUI navigation checks with the plugin manager contract.
- Require DSH >= 0.1.7-rc.1 in engines and runtime peers; pin development SDK packages to that release, align Cordis/Schemastery versions, and replace the retired code-runtime dependency with ptc-runtime.
- Use SessionId job ownership and JobOutcome.result for both success summaries and failures. Keep lifecycle, output consumption, notification/wakeup and archive admission in the host registry; cancellation still stops only the current shared-operation waiter.
- Read attachment references from the current first-class tool-role message surface instead of the removed nested tool-result block protocol. Exact reference handoff and visible-session-only access are unchanged.
- Replace local Client slot/context type shims with published Locale, Connection, Remote and renderer/slot contracts. Preserve explicit draft saving, maintenance confirmation and channel-local loopback restrictions alongside native operator-Peer authentication.

### Fixed

- Fix activation on DSH 0.1.7-rc.1 after removal of settings.register: consume Loader Config volatile references and published SettingsForms types, with automatic forms disabled for the custom draft/confirmation page.
- Save complete live fields to the actual profile entry id, preserving ordinary restart-only fields and explicit defaults over inherited profile values. Validate the complete domain config before persistence; avoid settings writes during activation.
- Cover activation, live updates without remount, profile persistence/restart, invalid-write rejection and inherited-default overrides using the published SettingsForms, ConfigEditor and Loader.

Provider/config/cache formats, cursor v3, index v2 and local page rendering are unchanged; existing parsed caches require no migration.

## 0.1.1

### Added

- Accept `attachment_id` as an alternative to `file_path` in `read_pdf` content, cursor and page requests and in `async_parse_pdf`. Both source fields are optional in schemas; exactly one is required at runtime, and callers should retain the same source selector on continuation; existing cursor identity validation is unchanged.
- Resolve full SHA-256 content IDs or unique 8–64 hexadecimal digest prefixes (optionally `sha256:`-prefixed) from current-session visible file and nested tool-result refs. Reject ambiguous matches and pass the exact matched ref to DSH `fileHostPath`; compacted-out refs are not searched.

DSH retains ownership of stored files. Hosts without local-path capability return `UNSUPPORTED_OPTION`; no stream materialization, new integrity checks, storage migration or Provider changes are introduced.

## 0.1.0

### Added

- Added eight accessible settings cards with configuration summaries, expand/collapse-all controls, native keyboard-navigable Provider selection, and bilingual labels. Collapsed panels remain mounted to preserve form drafts.
- Added browser regressions for keyboard navigation, disclosure state, draft preservation, load-error recovery, immutable security limits, dark/light themes, and narrow-pane overflow, plus bilingual dictionary coverage.

### Changed

- Redesigned the MinerU settings page with DSH theme-aware cards, lightweight SVG icons, clearer action hierarchy, and progressive disclosure for advanced configuration. Narrow settings panes use compact layouts, and reduced-motion preferences are respected.
- Refreshed setup instructions and the settings preview to match the current configuration page. Existing Provider, credential, numeric validation, storage-maintenance, reader cursor v3, and index v2 contracts remain unchanged.

### Fixed

- Show configuration load failures with an explicit retry action instead of leaving the page in an ambiguous loading state.
- Display restart-only security limits as disabled controls rather than accepting edits that the running host cannot save. Preserve explicit preview/confirmation boundaries for destructive maintenance operations.

## 0.0.15

### Added

- Added a local PDF.js 6.3.289 + @napi-rs/canvas 1.0.9 subprocess fallback for original-page rendering. Normal installation includes renderer dependencies and package-local font/CMap/WASM resources; no system Poppler installation is required on supported native platforms.
- Added explicit original-page renderer identity to result types, strict tool output schemas, Native text and presentation metadata; physical page-count provenance distinguishes pdfinfo from pdfjs.
- Added deterministic backend-selection regressions, isolated PDF.js worker tests, full-tool offline auto/fallback smoke modes and an installed-package smoke from an unrelated working directory.

### Changed

- Keep Poppler preferred; fall back only when an executable is missing or explicitly unavailable in the execution environment, never for PDF failures, page/hash validation, cancellation, timeout or resource limits.
- Both backends share one checked snapshot, concurrency slot and total deadline. PDF.js parsing and Canvas allocation run only in a fixed child process with bounded output and local package resources; cancellation waits for process reaping before cleanup.
- Ship the unbundled PDF.js subprocess entry explicitly and keep native/PDF runtime dependencies external to host/client bundles. Document native-platform installation conditions, resource controls and fidelity differences without claiming OS sandbox isolation or pixel equivalence.

### Fixed

- Preserve cancellation and the shared deadline when temporary cleanup completes late; cleanup failures cannot replace an already determined primary error.
- Distinguish Poppler output I/O failures and abnormal process termination from invalid PDFs without retrying another backend.
- Reject truncated/corrupt PNG containers with bounded chunk, checksum and end-marker validation before attachment delivery.

Reader cursor v3, index v2, Provider contracts and parsed cache formats remain unchanged.

## 0.0.14

This release includes the bounded-reader work recorded under 0.0.13; the previous published release is 0.0.12.

### Fixed

- Kept the continuation cursor explicitly nullable in every read response, including completed selections.
- Cursor continuations now inherit the caller's image presentation intent; explicit `inline_images` overrides update the next cursor without bypassing current model capabilities or image budgets.
- Restored reference lists and other supported `list_items` content from cached MinerU results without reparsing, renumbering or fabricating text.
- Scoped block quality diagnostics to the actual delivered text, including TOC, table, search and continuation selections; document/selection notices are not replayed on every chunk.
- Recognized known header/footer/page-number/footnote and flat reference blocks instead of emitting misleading unknown-type warnings for them.

### Added

- Added stable structured `diagnostics`, advisory formula `verification_hints`, and `provenance` separating upstream parsing configuration from index/reader versions. Unknown upstream engine versions are explicitly null.
- Added bounded inline-gap diagnostics and dual-provider offline review-paper regressions; suspect formulas remain unchanged and are never silently repaired.
- Added explicit `metadata_shortened` markers when quality/provenance metadata cannot fit a small output budget.

### Changed

- Consolidated interim implementation reports into the maintained PDF reading guide and refreshed README/architecture documentation.
- Reader cursor v3 persists image intent and rejects v1/v2 tokens with a restart instruction. Index v2 reprojects existing immutable artifacts; it does not invalidate parse caches or automatically upload documents.

## 0.0.13

### Added

- Added stable result-bound block IDs, original figure/table labels, literal document search (`query`), and exact block reading (`block_id`).
- Added local original-page verification (`view: "page"`) using bounded Poppler processes, private streaming snapshots, source SHA-256 checks, cancellation, and cleanup, without Provider upload.
- Added nested MinerU span normalization preserving inline mathematics, value-free bounded fidelity diagnostics, and explicit per-chunk visual coverage.
- Added an opt-in offline built-plugin smoke test (`smoke:reader-local`) and model-workflow regression fixtures.

### Changed

- Default read response budget is now 12,000 UTF-16 units; body chunks are capped at 8,000 units, with an additional 48,000-byte JSON/prose ceiling. Explicit larger response configurations no longer expand individual body chunks.
- Default reading omits exported cache paths and duplicate TOC metadata. Use `focus: "artifacts"` for exports and `focus: "toc"` for a complete resumable outline.
- **Reading cursor v2:** projection changes invalidate v1 cursors explicitly; restart without a cursor. Continuations are cache-only and bind selected text plus manifest artifact identity; cache eviction never silently triggers a new upload. Parsed cache manifests and Provider cache semantics are unchanged.
- Distinguished authoritative page metadata from a content-list lower bound and rejected page filtering that would silently discard unlocated evidence.
- Clarified that text completion does not guarantee OCR fidelity or image attachment coverage.

### Fixed

- Stopped renumbering original figure labels after page selection, and stopped replaying preceding indexed figures on text continuation.
- Kept complete outlines available instead of silently truncating Markdown fallback headings.
- Prevented the native renderer from preserving a misleading complete footer after emergency output truncation.

## 0.0.12

### Added

- Pruned default configuration values on save via `pruneConfigToDiff` so that unchanged defaults are not written to `settings.yaml`, preventing user configuration bloat.
- Added automatic startup slimming via `detectBloatedSettingsOps` and `settings.mutate` to clean up legacy bloated default entries from existing `settings.yaml` files.
- Added page-level "Reset to Defaults" and section-level "Reset" controls in the Web settings UI to easily restore default values.

### Changed

- Raised the minimum supported DSH version to `0.1.5-rc.2` and aligned DSH runtime peers, development dependencies, and the lockfile with that release. Node.js requirements, Provider configuration, cache formats, and tool arguments are unchanged.
- Use typed live Agent/session route access for image-capability detection, retaining request-header precedence, Agent-option fallback, and conservative handling of unavailable model metadata.
- Replace obsolete Host, Tool, and Connection ambient declarations with published types; align client RPC calls and tool schema inference with the rc.2 contracts.

### Fixed

- Explicitly inject both `connection` and `webServer` for RPC registration now that Connection no longer requires WebServer. Headless hosts retain both model tools without attempting HTTP route registration.
- Use a caller-local guarded route registrar to handle Cordis service-getter dependency scoping and enforce loopback-only RPC access independently of the unsupported `authority` argument, while retaining native Connection authentication and response handling.
- Include required empty `details` in RPC error envelopes so rc.2 clients retain actionable MinerU errors instead of rejecting the wire response.

## 0.0.11

### Added

- Added the live `output.maxInlineImages` setting for configuring the per-`read_pdf` inline image budget, defaulting to 6.
- Added `artifacts` focus option to `read_pdf`, gating secondary artifact file paths (such as `layout.json` and `model.json`) so they are omitted by default unless explicitly requested.
- Added automatic legal document boundary clamping (`narrowPageSelection`) for page range selections in `read_pdf`.

### Changed

- **Storage protocol upgrade (Breaking Change):** Stop every MinerU process sharing the root before upgrading. `.process.lock` is now a persistent version fence, not a lock to delete at normal shutdown. Local hard-link support and shared PID visibility are required; NFS/cross-host locking is not supported.
- **Configuration schema v2 (Breaking Change):** Versioned the current plugin configuration as schema v2 and added a bounded v1 migration that validates and removes obsolete `defaults.artifacts` and `limits.maxFilesPerRequest` fields before persisting the canonical v2 settings.
- **Continuation cursor contract (Breaking Change):** Replaced numeric line offsets (`read_offset_line`) with an opaque Unicode-safe `cursor` token for partial reading continuations.
- Cleaned up output prose presentation: removed verbose result headers and redundant manifest paths, displaying clear page range, total page count, and standardized figure labeling (`Figure N (Page X, "Title")`).
- Unified configuration parsing, snapshotted execution settings, and made startup-bound storage/payload limits explicit. Split settings sections and preserved numeric input drafts.
- Separated parse synopsis from body projection and aligned required tool schemas, English guidance, and actionable RPC failures.
- Consolidated current usage, architecture, deployment limits, and upgrade guidance; removed obsolete lock instructions and temporary audit/work logs.

### Fixed

- Ensured all tool outputs strictly conform to lossless JSON by omitting undefined optional properties instead of serializing `undefined`.
- Removed the obsolete `defaults.artifacts` field from the shipped Cordis configuration, restoring Host startup under strict configuration validation.
- Routed async completion through a separate bounded synopsis API instead of Markdown projection flags; oversized/invalid optional summary indexes now degrade explicitly without masking cache-integrity failures.
- Charged consumed image bytes on partial-read, final-stat, and close failures; required actual normalized attachment sizes and propagated cancellation after the final image.
- Replaced instance-held lock bypass and unsafe stale-file reclamation with scoped, cancellable local-filesystem bakery coordination and explicit mutation authority.
- Protected readers, image processing, producers, staging cleanup, and destructive maintenance across processes sharing a storage root; rejected symlinked traversal and publication ancestors.
- Added exact, Unicode-safe `read_pdf` continuation cursors and honest out-of-range/unsupported-selection errors; Native output includes the actual continuation token.
- Restricted image reads to manifest-declared artifacts, bounded attachments, and separated stable Figure identifiers from successful attachment order.
- Made cache reads non-mutating and published-result isolation explicitly guarded; the first valid publication wins for equivalent content even when filenames or nondeterministic provider bytes differ.
- Bounded maintenance traversal and exposed incomplete statistics as lower bounds in the settings UI.

### Removed

- Removed unused HTTP/transient-reference wrappers, batch router/coordinator code, migration naming, and transitional cache-key/presentation aliases.

## 0.0.10

### Fixed

- Guarded `shouldInline` in `read_pdf` to only activate when `focus` includes the image modality, preventing inline image emission for non-image focus modes (`toc`, `text`, `table`).
- Prevented `inlineImagesForSingleResult` from falling back to full document scanning when `ordered_images` for candidate pages is empty, adding comprehensive regression tests for per-page image isolation.

## 0.0.9

### Added

- Added `toc` option (with `outline` alias) to `focus` parameter in `read_pdf`, formatting and projecting document table of contents with hierarchical indentation and page indexing as Markdown.
- Added comprehensive unit tests covering TOC markdown formatting, focus normalization, and outline-only content projection.

### Fixed

- Omitted undeclared internal `attachmentRef` property from `inlined_images` tool output items to strictly conform to `readPdfResultSchema` (`additionalProperties: false`), reconstructing `ImageAttachmentRef` within `renderResult`.

## 0.0.8

### Changed

- Refactored model tool surface to decoupled, specialized single-document tools: `read_pdf` (synchronous reading with page slicing via `pages`, content focus filtering via `focus`, and reading-order multimodal figure inlining) and `async_parse_pdf` (native background parsing with document structure summary).
- Enforced single `file_path` across tools, pipeline, Zod schema, and SettingsPage, removing multi-file parameters (`file_paths`) and `maxFilesPerRequest` limit while preserving underlying provider batch primitives.
- Completely decoupled proprietary MinerU parameters (`model`, `ocr`, `formula`, `table`, `language`, `artifacts`, `max_inline_images`) from tool arguments; always request all artifacts from providers for permanent local caching.
- Replaced markdown preview fields with full `markdown_content` and authoritative `content_status` (`complete`, `partial`, `not_requested`), featuring fair character budget allocation, clean paragraph-boundary truncation, and resume line offsets for partial deliveries.
- Enhanced `pages` parsing to flexibly accept single numbers, number arrays, and range strings (e.g. `"1-3, 5"`); added `focus` filtering based on cached `content_list.json` with graceful fallback to Markdown.
- Strictly ordered inline images by natural document reading order, linked to page selection, bound markdown captions, and eliminated rigid image quotas.
- Re-architected model output and tool descriptions to strict Plain Text English with zero emoji, eliminating hallucinated guidance references to deprecated fields.
- Decoupled document presentation, outline (TOC) extraction, character budget allocation, and prose formatting from `MinerUService` into dedicated `src/service/result-presenter.ts`.
- Consolidated shared HTTP request pipelines, timeout management, error body diagnostics, and retry policies into `src/providers/http-client.ts`, eliminating duplicate logic across official and self-hosted providers.
- Upgraded `self-hosted-v2` multipart streaming to Node 22 native `FormData` and `openAsBlob`, removing third-party `form-data` package dependency.
- Replaced hand-rolled streaming JSON parser in `safe-zip` with standard V8 `JSON.parse`, and standardized delay timers across all modules using `node:timers/promises`.
- Adopted scoped locking (`withLock`) across mutating storage operations (`clearCache`, `commitTransaction`, `quarantine`) with contention backoff, eliminating startup lifetime lock holding to allow concurrent multi-process initialization.
- Eliminated self-inflicted read-only (`0o400`/`0o500`) permission cycles in `result-repository`, streamlining cache cleanup and quarantine deletions.
- Modernized single-process storage lock (`ProcessLock`) to use atomic file creation (`flag: 'wx'`) with cross-platform dead PID reclamation, retiring abstract Unix sockets and Windows named pipes.

### Removed

- Removed `mineru_health` from the model-facing tool surface, keeping it strictly as an internal loopback RPC probe for the Web GUI.
- Removed obsolete batch coordination (`batch-coordinator.ts`, `batchViewSchema`) in favor of unified `ResultView`.

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