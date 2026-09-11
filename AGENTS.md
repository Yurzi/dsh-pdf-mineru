# dsh-pdf-mineru Agent Guide

## Architecture

The plugin exposes two model tools (`read_pdf` and `async_parse_pdf`) over one versioned MinerU domain. Keep this dependency direction:

```text
tools -> DSH JobRegistry (async ownership, cancellation, completion)
  -> MinerUService
    -> RequestNormalizer
  -> ResultRepository
  -> SharedOperationRegistry
  -> ProviderRegistry
    -> SelfHostedV2Provider
    -> OfficialV4Provider

loopback RPC -> StorageMaintenanceService -> ResultRepository / ProcessLock
```

Reader details and usage contracts live in [docs/model-reading.md](docs/model-reading.md). Content reads flow through `document-index` (stable pre-selection identities and faithful normalization) and `read-delivery` (bounded chunks and cursor-v3); original-page verification uses `page-renderer` locally without a Provider.

Providers adapt upstream protocols only. They never register tools, inspect DSH Sessions, choose cache paths, resolve credentials, or generate model prose. Tools never call fetch, parse ZIP files, or construct storage paths.

## Domain contracts

- Plugin domain IDs use validated branded strings: `mr_`, `mf_`, `mp_`, and `mo_`; native background IDs are issued by DSH as `mineru-N`.
- Canonical request, cache key spec, and result manifest are independently versioned.
- Canonical requests persist file ID/name/bytes/SHA-256, never the local source path. `PreparedSourceFile.path` is ephemeral.
- ProviderJobRef is transient inside provider execution and contains task/batch IDs and dataId/fileId/name mappings. Never add upload, CDN, status, or result URLs.
- Result manifests contain normalized relative artifact paths. Resolve absolute paths only in ResultRepository.
- Published results are immutable and single-file. Batch support must fan out cache keys and manifests per source file.

## Session and concurrency rules

- Every tool requires `exec.agent.session`; pass the exact live Agent as the native DSH background job owner.
- `async_parse_pdf` registers `kind: mineru` with `ctx.jobs.start`; generic `job_output`, `job_list`, and `job_kill` own async control.
- `read_pdf` returns results directly and never creates a plugin Job.
- SharedOperation owns the producer AbortController. Waiter cancellation, including native `job_kill`, only stops that invocation's wait.
- Native job hooks omit `readOutput`, settle with a non-rejecting final-output Promise, and never expose provider refs.

## Reader invariants

- `complete` ends the selected parsed text, not OCR fidelity or visual coverage. Report physical page counts with their source; content-list counts are lower bounds, not proof that later pages do not exist.
- Cursor-v3 continuation is cache-only and binds result/selection, exact projection and artifact digests, reader/index versions, offset, and caller inline-image intent. Never start a Provider on a continuation miss. Omitted `inline_images` inherits intent; an explicit boolean overrides it.
- Keep block diagnostics and formula verification advisories scoped to delivered blocks; document/selection notices appear initially. Preserve parsing provenance separately from reader/index versions, and mark budget-shortened metadata with `metadata_shortened`.
- Preserve original `document_label`; attachment ordinal (`figure` compatibility field) is not a paper figure number. Default output is 12,000 characters overall, at most 8,000 body characters and 48,000 UTF-8 bytes per JSON/native response. Image count defaults to 6 but is configurable from 0–100, with separate byte limits.
- Original-page view verifies an optional source SHA-256 against a temporary streaming snapshot before rendering. Poppler time/concurrency/dimension/output limits are not an OS sandbox or a hard process-memory limit; deployment isolation remains necessary for hostile PDFs.

## Security invariants

- Resolve credentials once per Provider call and never cache or persist their values.
- Authenticated requests always use `redirect: error`.
- Official presigned PUT has an explicitly empty headers object. CDN requests have no auth headers.
- Hash source files as streams and re-stat them immediately before upload.
- ZIP extraction uses yauzl lazy entries, validates metadata first, then streams each entry through staging limits. Do not reintroduce whole-archive or whole-entry accumulation.
- storageRoot mutations use scoped ProcessLock; plugins register tools without lifetime lock holding.
- Result publication is staging validation followed by same-filesystem atomic rename. EXDEV is an error, not a copy fallback.
- Retry only idempotent GET and official PUT with a fresh source stream. Never auto-retry official batch-allocation POST or self-hosted multipart POST.
- Retry diagnostics contain only typed operation/status/count fields, never error messages, URLs, headers, bodies, credentials, or local paths.
- Destructive storage maintenance acquires scoped ProcessLock, never follows symlinks, defaults to read-only/dry-run, and blocks destructive work while SharedOperations or storage readers are active.
- Destructive maintenance stays loopback-only and requires explicit confirmation. Never expose maintenance as a model tool.

## Main files

- `src/domain/*`: IDs, requests, provider states, results, failures, strict boundary parsers.
- `src/providers/provider.ts`, `src/providers/retry.ts`: shared Provider/ArtifactSink contracts and bounded retry policy.
- `src/providers/self-hosted-v2.ts`: streaming multipart v2 adapter.
- `src/providers/official-v4.ts`: official API, bare PUT, status, and collection adapter.
- `src/providers/safe-zip.ts`: bounded ZIP scanner/extractor.
- `src/storage/*`: validated paths, process lock, ResultRepository, staging sink, and privileged maintenance service.
- `src/service/mineru-service.ts`: direct-result use-case orchestration and same-process operation coalescing.
- `src/service/document-index.ts`, `read-delivery.ts`: stable pre-selection block identity, faithful known-span normalization, bounded model projection and cursor-v3 delivery with inherited image intent and delivered-block diagnostics.
- `src/service/page-renderer.ts`: local original-page verification via bounded Poppler subprocesses and temporary streaming snapshots; never calls a Provider or retains sources.
- `src/tools.ts`: two defineTool schemas (`read_pdf` and `async_parse_pdf`), native DSH job adaptation, and pure renderers.
- `src/rpc.ts`, `src/loopback-rpc.ts`, `src/client/*`: loopback config/maintenance RPC, caller-local guarded native transport registration, and Provider-aware settings page.
- `src/observability.ts`: typed, non-throwing structured diagnostic events.
- `scripts/smoke-reader-cache.mjs`: explicit offline replay of the known rx033 review PDF and existing cached manifest through the built reader/tool chain; rejects network fetches, not a fresh extraction or generic arbitrary-PDF smoke.
- `scripts/smoke-reader-local.mjs`: explicit local original-page smoke with Poppler and no upload.
- `scripts/smoke-official-v4.mjs`: explicit live smoke through the built plugin tool chain.
- `scripts/verify-current-gui.mjs`: isolated current-bundle verification in the existing DSH Web shell.

## Compatibility

Only canonical Provider-based config and current tool arguments are accepted. Do not reintroduce flat-config migration or deprecated tool aliases. Preserve `parseMethod` in cache semantics: `txt` is not equivalent to `auto`. Official v4 rejects `txt` because its `is_ocr` field cannot represent that distinction.

## Commands

```sh
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
git diff --check
pnpm run verify:gui

# Explicit local-only real-PDF smoke (requires Poppler; no upload).
pnpm run smoke:reader-local -- /absolute/path/sample.pdf 1

# Explicit offline known-fixture cache replay (requires a current build and matching cached artifacts).
# Optional third argument: output-directory for local evidence, not committed reports.
pnpm run smoke:reader-cache -- /absolute/path/rx033.pdf /absolute/path/manifest.json

# Explicit live test only; never run by default.
MINERU_API_KEY=<token> pnpm run smoke:official-v4 -- /absolute/path/sample.pdf
```

Tests must remain mock/fixture based by default and cover failure, cancellation, retry exhaustion, Retry-After, unsafe POST non-retry, security, concurrency, persistence, maintenance fail-closed behavior, confirmations, and render/output limits. All ESM relative imports include `.js`. Every object in a tool schema declares `additionalProperties`.

## Documentation maintenance

Maintain durable current-state docs: README.md for setup/quick use, ARCHITECTURE.md for implementation boundaries, [docs/model-reading.md](docs/model-reading.md) for the model reader contract and validation, AGENTS.md for contributor rules, and CHANGELOG.md for versioned changes. Update them together when behavior changes; preserve unrelated storage, Provider, and security contracts.

Do not add or retain transient implementation plans, session logs, acceptance dumps, or interim improvement/reliability reports under docs/. Fold lasting facts into the maintained guides and remove obsolete reports and their links. Keep smoke output, screenshots, and one-off release-note bodies outside tracked documentation (for example in ignored local evidence directories).

## Release Workflow and Notes Template

### Release Steps

The following commands are the authorized release operator’s workflow, not permission for an agent doing documentation or verification to commit, push, publish, or create a release. Obtain explicit authorization for those side effects.

1. **Version Bump**: Update `"version"` in `package.json`.
2. **Update maintained docs**: Add a `## X.Y.Z` CHANGELOG.md section following Keep a Changelog categories (`### Added`, `### Changed`, `### Fixed`, `### Removed`), and reconcile README.md, ARCHITECTURE.md, AGENTS.md, and docs/model-reading.md with current behavior. Remove obsolete interim reports rather than publishing them.
3. **Verification**: Run `pnpm run build && pnpm run typecheck && pnpm test && git diff --check && pnpm run verify:gui`.
4. **Review, Commit & Annotated Tag**: Review the complete diff and stage only intended release files (including any reviewed source/test/doc changes and obsolete-doc deletions); do not blindly stage unrelated workspace edits. Ensure the package version and tag agree.
   ```sh
   git add package.json CHANGELOG.md README.md ARCHITECTURE.md AGENTS.md docs/model-reading.md
   # Stage any other reviewed release changes explicitly before committing.
   git commit -m "release: vX.Y.Z"
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin main
   git push origin vX.Y.Z
   ```
   **The tag push is the publish trigger:** the existing `.github/workflows/publish.yml` runs on pushed `v*` tags, typechecks, tests, builds, and publishes to npm with provenance. Inspect its outcome; do not add another publish workflow or run a duplicate manual npm/pnpm publish. Pushing main alone and creating GitHub release notes are not this workflow’s trigger.
5. **Create GitHub Release via gh CLI**: Use the already-pushed tag and a reviewed notes file kept outside tracked docs.
   ```sh
   gh release create vX.Y.Z --verify-tag --title "vX.Y.Z" --notes-file <file>
   ```

### GitHub Release Notes Template

Omit the `# [Version]` title header from the body as GitHub renders the release title automatically. Each entry must annotate its commit link. Omit sections (`## Added`, `## Fixed`, `## Changed`, `## Removed`) if there are no corresponding items for that release. Use the actual release commits and previous/current tags in links; do not publish placeholders or a transient verification transcript.

```markdown
[Overview paragraph summarizing the release]

## Added
- [Feature description] ([short_sha](https://github.com/Yurzi/dsh-pdf-mineru/commit/full_sha))

## Fixed
- [Bug fix description] ([short_sha](https://github.com/Yurzi/dsh-pdf-mineru/commit/full_sha))

## Changed
- [Change description] ([short_sha](https://github.com/Yurzi/dsh-pdf-mineru/commit/full_sha))

Full Changelog: https://github.com/Yurzi/dsh-pdf-mineru/compare/v[Previous]...v[Current]
```
