# dsh-pdf-mineru Agent Guide

## Architecture

The plugin exposes two model tools (`read_pdf` and `async_read_pdf`) over one versioned MinerU domain. Keep this dependency direction:

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
- `async_read_pdf` registers `kind: mineru` with `ctx.jobs.start`; generic `job_output`, `job_list`, and `job_kill` own async control.
- `read_pdf` returns results directly and never creates a plugin Job.
- SharedOperation owns the producer AbortController. Waiter cancellation, including native `job_kill`, only stops that invocation's wait.
- Native job hooks omit `readOutput`, settle with a non-rejecting final-output Promise, and never expose provider refs.

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
- `src/tools.ts`: two defineTool schemas (`read_pdf` and `async_read_pdf`), native DSH job adaptation, and pure renderers.
- `src/rpc.ts`, `src/client/*`: loopback config/maintenance RPC and Provider-aware settings page.
- `src/observability.ts`: typed, non-throwing structured diagnostic events.
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

# Explicit live test only; never run by default.
MINERU_API_KEY=<token> pnpm run smoke:official-v4 -- /absolute/path/sample.pdf
```

Tests must remain mock/fixture based by default and cover failure, cancellation, retry exhaustion, Retry-After, unsafe POST non-retry, security, concurrency, persistence, maintenance fail-closed behavior, confirmations, and render/output limits. All ESM relative imports include `.js`. Every object in a tool schema declares `additionalProperties`.
