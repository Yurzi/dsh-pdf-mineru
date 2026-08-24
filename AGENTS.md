# dsh-pdf-mineru Agent Guide

## Architecture

The plugin exposes five stable model tools over one versioned MinerU domain. Keep this dependency direction:

```text
tools -> MinerUService
  -> RequestNormalizer
  -> JobRepository
  -> ResultRepository
  -> SharedOperationRegistry
  -> ProviderRegistry
    -> SelfHostedV2Provider
    -> OfficialV4Provider
```

Providers adapt upstream protocols only. They never register tools, inspect DSH Sessions, choose cache paths, resolve credentials, or generate model prose. Tools never call fetch, parse ZIP files, or construct storage paths.

## Persistent contracts

- IDs use validated branded strings: `mj_`, `mr_`, `mf_`, `mp_`, and `mo_`.
- Job, canonical request, cache key spec, and result manifest are independently versioned.
- Canonical requests persist file ID/name/bytes/SHA-256, never the local source path. `PreparedSourceFile.path` is ephemeral.
- ProviderJobRef persists only task/batch IDs and dataId/fileId/name mappings. Never add upload, CDN, status, or result URLs.
- Result manifests contain normalized relative artifact paths. Resolve absolute paths only in ResultRepository.
- Published results are immutable and single-file. Batch support must fan out cache keys and manifests per source file.

## Session and concurrency rules

- Every tool requires `exec.agent.session`; use `session.header.id` for ownership.
- JobRepository public operations require a Session-shaped object, not a naked session ID.
- Each submit creates a distinct session Job even on a cache hit or shared operation.
- SharedOperation owns the producer AbortController. Waiter cancellation only stops that invocation's wait.
- Persist the provider ref to every waiter immediately after upstream acceptance so restart recovery works.
- An uploading Job without a complete ref becomes `INTERRUPTED_UPLOAD` after restart.

## Security invariants

- Resolve credentials once per Provider call and never cache or persist their values.
- Authenticated requests always use `redirect: error`.
- Official presigned PUT has an explicitly empty headers object. CDN requests have no auth headers.
- Hash source files as streams and re-stat them immediately before upload.
- ZIP extraction uses yauzl lazy entries, validates metadata first, then streams each entry through staging limits. Do not reintroduce whole-archive or whole-entry accumulation.
- storageRoot is single-process; acquire ProcessLock before registering tools.
- Result publication is staging validation followed by same-filesystem atomic rename. EXDEV is an error, not a copy fallback.

## Main files

- `src/domain/*`: IDs, requests, jobs, results, failures, strict persistent parsers.
- `src/providers/provider.ts`: shared Provider and ArtifactSink contracts.
- `src/providers/self-hosted-v2.ts`: streaming multipart v2 adapter.
- `src/providers/official-v4.ts`: official API, bare PUT, status, and collection adapter.
- `src/providers/safe-zip.ts`: bounded ZIP scanner/extractor.
- `src/storage/*`: validated paths, process lock, Job/Result repositories, staging sink.
- `src/service/mineru-service.ts`: complete use-case orchestration and recovery.
- `src/tools.ts`: five defineTool schemas and pure renderers.
- `src/rpc.ts`, `src/client/*`: loopback config RPC and Provider-aware settings page.
- `scripts/verify-current-gui.mjs`: isolated current-bundle verification in the existing DSH Web shell.

## Compatibility

The current major accepts legacy flat config and old tool arguments. Conversion is immediate and explicit. Preserve `parseMethod` in cache semantics: legacy `txt` is not equivalent to `auto`. Official v4 rejects `txt` because its `is_ocr` field cannot represent that distinction.

## Commands

```sh
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
git diff --check
```

Tests must remain mock/fixture based by default and cover failure, cancellation, security, concurrency, persistence, and render/output limits. All ESM relative imports include `.js`. Every object in a tool schema declares `additionalProperties`.
