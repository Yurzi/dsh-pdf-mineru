# dsh-pdf-mineru Agent Guide

Standing orders for anyone changing this plugin. The module map and implementation detail live in [ARCHITECTURE.md](ARCHITECTURE.md); setup, scripts, tests, manual verification and releases live in [CONTRIBUTING.md](CONTRIBUTING.md); the model reader contract lives in [docs/model-reading.md](docs/model-reading.md).

## Architecture

Two model tools (`read_pdf`, `async_parse_pdf`) sit on one versioned MinerU domain. Keep this dependency direction ([details](ARCHITECTURE.md#模块地图)):

```text
tools -> ReaderService -> ParseService -> SharedOperationRegistry
                                       -> createProvider -> providers/<type>
                                       -> ResultRepository
loopback RPC -> settings persistence / ParseService.probe / StorageMaintenanceService
```

- Tools never call fetch, parse ZIP files, construct storage paths, or import service/storage/providers directly.
- Providers adapt upstream protocols only: they never register tools, inspect DSH Sessions, choose cache paths, resolve credentials, or generate model prose.
- storage imports no service or provider implementation; domain, config, contracts and source are leaves.
- The client imports only `contracts/`, `config/model` and `domain/ids`.
- Add Provider types through `PROVIDER_TYPES`/`PROVIDER_TRAITS`; do not branch on provider type in service or reader code.

## Domain contracts

- Plugin IDs are validated branded strings (`mr_`, `mf_`, `mp_`, `mo_`). Native job IDs are issued by DSH; never parse or document their format as a contract.
- Canonical request, cache key spec and result manifest are independently versioned. Canonical requests persist file ID/name/bytes/SHA-256, never the local path; `PreparedSourceFile.path` is ephemeral.
- ProviderJobRef is transient and holds task/batch IDs and dataId/fileId/name mappings. Never add upload, CDN, status or result URLs.
- Manifests hold normalized relative artifact paths; only ResultRepository resolves absolute paths. Published results are immutable and single-file; batch support fans out cache keys and manifests per file.
- Preserve `parseMethod` in cache semantics: `txt` is not `auto`. Official v4 rejects `txt`.

## Session and concurrency

- Every tool requires `exec.agent.session`. Resolve `file_path` once at the tool boundary against `ctx.workingDirectory.ensure(agent, signal)`; services and renderers receive absolute paths only. `async_parse_pdf` resolves its path and config snapshot before `jobs.start`.
- `async_parse_pdf` uses `ctx.jobs.start` with `kind: mineru`, `owner: agent.session.id`, `toolCall: { callId, rootCallId }` and `outputLimitBytes: 48_000`. Generic `job_output`/`job_list`/`job_kill` own control; `read_pdf` never creates a job.
- Job hooks settle a non-rejecting `done: Promise<JobOutcome>` with `result`. Phases go through `JobHandle.updateProgress` and contain no paths, credentials, provider refs or invented percentages; observer failures never alter parsing or cancellation.
- SharedOperation owns the producer AbortController. Waiter cancellation, including `job_kill`, stops only that invocation's wait.
- Each invocation reads one config snapshot and passes it down; never re-read live config mid-operation.

## Source selection

- `file_path` and `attachment_id` are both optional in schemas; runtime requires exactly one, for content, cursor continuation, page view and async parse. Cursor-v3 validates result/projection identity, not selector spelling.
- Accept full `sha256:<64hex>` IDs or 8–64 hex prefixes (optional `sha256:`). Match unique content IDs; reject ambiguous prefixes.
- Resolve only file refs visible through the current session's `deriveMessages()`, including flat content in `role: "tool"` messages. Do not restore nested `tool-result` blocks. Pass the exact matched ref to `fileHostPath`; never reconstruct refs, scan global storage, or materialize streams. Missing host-path capability is `UNSUPPORTED_OPTION`.

## Reader invariants

- `complete` ends the selected parsed text, not OCR fidelity or visual coverage. Report page counts with their source; content-list counts are lower bounds.
- Cursor-v3 continuation is cache-only and binds result/selection, exact projection and artifact digests, reader/index versions, offset and inline-image intent. Never start a Provider on a continuation miss. Omitted `inline_images` inherits intent; an explicit boolean overrides it.
- Scope block diagnostics and formula hints to delivered blocks; document/selection notices appear initially. Keep parsing provenance separate from reader/index versions; mark budget-shortened metadata with `metadata_shortened`.
- Preserve original `document_label`; the attachment ordinal (`figure`) is not a paper figure number. Budgets are defined once in [model-reading](docs/model-reading.md#预算); change them there and in code together.
- `presentationMeta` stays a compact summary; evidence lives only in the canonical result value.
- Original-page view verifies optional SHA-256 against a temporary streaming snapshot before rendering. Poppler-first/PDF.js-fallback share one snapshot, deadline and semaphore slot. Renderer limits are not an OS sandbox or a hard memory limit; hostile PDFs still need deployment isolation. Never import heavy PDF/native dependencies into the host bundle or execute PDF scripting/network actions.

## Security invariants

- Resolve credentials once per Provider call; never cache or persist their values. A mounted DSH credential service decides alone; read `process.env` only when no credential service exists.
- Authenticated requests always use `redirect: error`. Official presigned PUT has an explicitly empty headers object; CDN requests carry no auth headers.
- Hash source files as streams and re-stat them immediately before upload.
- ZIP extraction uses yauzl lazy entries, validates metadata first, then streams each entry through staging limits. Do not reintroduce whole-archive or whole-entry accumulation.
- storageRoot mutations use scoped ProcessLock; plugins register tools without lifetime lock holding.
- Result publication is staging validation followed by same-filesystem atomic rename. EXDEV is an error, not a copy fallback.
- Retry only idempotent GET and upload PUT with a fresh source stream. Never auto-retry official batch-allocation POST, self-hosted multipart POST, or V1 create/complete/job POSTs.
- Retry diagnostics contain only typed operation/status/count fields, never error messages, URLs, headers, bodies, credentials or local paths.
- Destructive storage maintenance acquires scoped ProcessLock, never follows symlinks, defaults to read-only/dry-run, and blocks while SharedOperations or storage readers are active.
- Admin RPC (config, probe, maintenance) requires an owner principal first, then a loopback Host authority; neither replaces the other. Destructive maintenance requires explicit confirmation, and cache clear requires the preview's confirmation token. Never expose maintenance as a model tool.

## Compatibility and settings

- `engines.dsh` alone decides DSH compatibility. Keep DSH peers equal to it and dev pins at its exact lower bound ([upgrade steps](CONTRIBUTING.md#upgrading-the-dsh-baseline)). Use published host types, not ambient replacements.
- Register the config page only in `plugins.bundle.config`, keyed by `dsh-pdf-mineru`, via the public plugin-manager slot contract. No global `settings.section`; do not require the optional `form` prop.
- Settings uses Config `.volatile()` fields and `settings.configure({ auto: false }, ctx.fiber)`. Never write settings during activation; DSH owns legacy document import.
- Saves are explicit and complete: validate the whole domain config, keep `storageRoot`/`limits` equal to runtime, write live values through `settings.replace` with the actual Loader entry id, and use `ConfigEditor.edit` only for an explicit save of a still-historical raw entry. Failed persistence publishes nothing.
- Saves are revision-aware: `config.get`/`config.set` carry the host revision; a stale save fails with `mineru/conflict`. Never auto-save drafts or let native forms bypass maintenance confirmation.
- Config is schemaVersion 3 with ordered in-memory 1→2→3 migrations (missing version = 2). Migration never infers HTTP consent or protocol, never exposes old values, and Standard Schema wraps the migrated result. Unknown future versions and cross-protocol fields are errors. Do not reintroduce flat config or deprecated tool aliases.
- V1 uses per-profile `ocrMode` and optional `tier`, ignores shared legacy/cloud defaults without altering their draft values, and reports provenance model `null`.

## Code conventions

- TypeScript ESM relative imports include `.js`; the PDF.js worker is a standalone `.mjs` copied by the build.
- Every object in a tool schema declares `additionalProperties`.
- Run `pnpm run check` and `git diff --check`; run `pnpm run test:e2e` when the client, packaging or the DSH baseline changes ([details](CONTRIBUTING.md#end-to-end-tests)).

## Documentation maintenance

- One home per fact: README (users, setup), docs/configuration.md (settings, providers, storage operations), docs/model-reading.md (reader contract), ARCHITECTURE.md (module map and implementation boundaries), CONTRIBUTING.md (workflow), AGENTS.md (standing orders), CHANGELOG.md (history). Link instead of restating.
- Document current state only; version history belongs in CHANGELOG. Prose names no DSH version except the README requirement line, which mirrors `engines.dsh`.
- Do not add plans, session logs, acceptance dumps or interim reports under docs/. Keep evidence and release-note drafts in ignored local directories.

## Release

See [CONTRIBUTING.md](CONTRIBUTING.md#release). Never commit, tag, push, publish or create a release without explicit authorization.
