# Contributing

This guide covers local setup, tests, manual verification, DSH baseline upgrades and releases. Module boundaries live in [ARCHITECTURE.md](ARCHITECTURE.md); standing rules for agents and reviewers live in [AGENTS.md](AGENTS.md).

## Setup

- Node.js `^22.19.0 || >=24.0.0` and the pnpm version named by `packageManager` in [package.json](package.json).
- `pnpm install` installs into a workspace-local store (`.pnpm-store/`, see [pnpm-workspace.yaml](pnpm-workspace.yaml)). DSH host packages are pinned exactly in `devDependencies` and `autoInstallPeers` is off, so the compiler sees one copy of each.
- Generated output (`lib/`) is not committed. Run `pnpm run build` before installing the checkout into DSH with `link:`, before `verify:gui` and before any smoke script.

## Scripts

| Script | Purpose |
| --- | --- |
| `pnpm run check` | Lint, typecheck, build, then test. CI runs this on every push to `main` and every pull request |
| `pnpm run lint` | oxlint correctness rules over `src`, `tests`, `build` and `scripts` |
| `pnpm run typecheck` | Node program (`tsconfig.json`), browser program (`tsconfig.client.json`) and tests (`tsconfig.test.json`) |
| `pnpm run build` | Clean `lib/` and build the host bundle, the client bundle and the copied PDF.js worker with tsdown |
| `pnpm run watch` | tsdown watch mode |
| `pnpm test` | Run all Vitest projects once |
| `pnpm run test:watch` | Vitest watch mode |
| `pnpm run verify:gui` | Manual browser check of the settings page in a running DSH Web |
| `pnpm run smoke:reader-local` | Manual offline original-page smoke through the built tool chain |
| `pnpm run smoke:official-v4` | Manual live parse against the official API (uploads the PDF) |

Also run `git diff --check` before handing off a change.

## Tests

Vitest runs two projects from one `pnpm test` invocation (see [vitest.config.ts](vitest.config.ts)):

- **unit**: source-level specs. They never import `lib/`.
- **package**: specs that load the built `lib/` bundle or a packed artifact. They need a fresh build first; `pnpm run check` orders that for you. Run one project with `pnpm exec vitest run --project unit`.

Shared fakes and harnesses (HTTP fake, provider context, reader and tool harnesses, storage fixtures) live in `tests/support/`. Reuse them instead of building new mocks per spec.

Policy:

- Tests are mock- or fixture-based by default and never touch the network or a real MinerU service.
- Cover behavior at trust and failure boundaries: failure and cancellation paths, retry exhaustion, `Retry-After`, no replay of unsafe POSTs, credential placement, ZIP and path safety, concurrency and cross-process locking, persistence and migration, maintenance fail-closed behavior and confirmations, renderer and output limits, cursor continuation, and the model-visible output.
- Prefer one real composition (real ParseService/ReaderService over a fake provider, real Settings/ConfigEditor) over many assertions that a dependency was called.
- Do not test version pins beyond the package contract check, prose wording that is not a contract, removed APIs, or obvious branches. Delete tests for code you delete.

## Manual verification

Keep smoke output, screenshots and other evidence under the ignored `.vitest-cache/` directory; never commit it.

**Settings page** (whenever `src/client/` changes):

```sh
pnpm run build
pnpm run verify:gui
```

The script loads the current `lib/client.js` into an already running DSH Web shell (`DSH_WEB_URL` or `DSH_WEB_AUTH_URL`, default `http://127.0.0.1:3080`) with Chromium from `CHROMIUM_PATH` (default `/usr/bin/chromium`). It uses browser-only fixtures for RPC, credentials and the plugin inventory and freezes the test browser's HMR graph, so it never changes the real configuration, credentials, cache or installed plugin. It checks that the page appears in the Plugins bundle detail and not in global Settings, plus desktop and mobile layouts and the save and maintenance flows. Screenshots go to `.vitest-cache/gui/`. If an unrelated plugin blocks the shell from booting, exclude it from the browser fixture only with `DSH_GUI_EXCLUDE_PLUGINS=<id>[,<id>]` and report the exclusion; MinerU itself cannot be excluded. This is not a live Provider test.

**Original-page rendering** (no upload):

```sh
pnpm run smoke:reader-local -- /absolute/path/sample.pdf 1 --backend=auto
pnpm run smoke:reader-local -- /absolute/path/sample.pdf 1 .vitest-cache/pdfjs --backend=pdfjs
```

`--backend=pdfjs` gives the plugin an empty `PATH` for this run only, proving the automatic PDF.js fallback. `--expect-renderer=poppler|pdfjs` asserts the renderer that was used.

**Live official API** (explicit opt-in; uploads the document and spends quota):

```sh
MINERU_API_KEY=<token> pnpm run smoke:official-v4 -- /absolute/path/sample.pdf
```

**Packed artifact** (before a release that changes dependencies, packaging or the renderer): run `pnpm pack --out .vitest-cache/dsh-pdf-mineru.tgz`, extract and install it with production and DSH peer dependencies in an isolated project outside this workspace, then:

```sh
node scripts/smoke-reader-package.mjs /abs/installed/node_modules/dsh-pdf-mineru /abs/sample.pdf 1 .vitest-cache/package-smoke --backend=pdfjs
```

It checks entry points, production dependencies and package resources, and calls the full `read_pdf` chain from an unrelated working directory. Real-document checks should include embedded CJK fonts, math, two-column and rotated pages, and transparency; look at the images.

## Upgrading the DSH baseline

1. Read the host's upgrade-guide entries (`docs/upgrade-guide/<version>/` in the DeepSeek Harness repository) for every release between the old and new baseline.
2. In [package.json](package.json): set `engines.dsh` to the new range (it alone decides compatibility), set every `@deepseek-ai/dsh-*` peer to the same range, and pin every `@deepseek-ai/dsh-*` dev dependency to the exact lower bound. Align the `cordis`, `cosmokit` and `schemastery` ranges with the host. The package contract test enforces peers == `engines.dsh` and dev pins == its lower bound.
3. Run `pnpm install`, then `pnpm run check` and `pnpm run verify:gui`.
4. Add a CHANGELOG entry. Prose outside CHANGELOG and the README requirement line must not name DSH versions.

## Release

The following steps are the authorized release operator's workflow, not permission for an agent doing documentation or verification work to commit, push, tag, publish, or create a release. Obtain explicit authorization for those side effects.

1. **Version bump**: update `"version"` in `package.json`.
2. **Update maintained docs**: rename `## Unreleased` in CHANGELOG.md to `## X.Y.Z` (Keep a Changelog categories: `### Added`, `### Changed`, `### Fixed`, `### Removed`), and reconcile README.md, docs/configuration.md, docs/model-reading.md, ARCHITECTURE.md, AGENTS.md and this file with current behavior.
3. **Verification**: `pnpm run check && git diff --check && pnpm run verify:gui`, plus the packed-artifact smoke when packaging or dependencies changed.
4. **Review, commit and annotated tag**: review the complete diff and stage only intended release files; do not blindly stage unrelated workspace edits. The tag must equal `v` + the package version.

   ```sh
   git add package.json CHANGELOG.md README.md ARCHITECTURE.md AGENTS.md CONTRIBUTING.md docs/
   # Stage any other reviewed release changes explicitly before committing.
   git commit -m "release: vX.Y.Z"
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin main
   git push origin vX.Y.Z
   ```

   **The tag push is the publish trigger.** [publish.yml](.github/workflows/publish.yml) runs on pushed `v*` tags: it verifies that the tag matches the package version, runs `pnpm run check` (build before tests) and publishes to npm with provenance. Inspect its outcome; do not add another publish workflow or run a manual `npm`/`pnpm publish`. Pushing `main` alone or creating GitHub release notes does not publish.
5. **GitHub release**: use the already-pushed tag and a reviewed notes file kept outside tracked docs.

   ```sh
   gh release create vX.Y.Z --verify-tag --title "vX.Y.Z" --notes-file <file>
   ```

### GitHub release notes template

Omit the `# [Version]` title (GitHub renders the release title). Annotate every entry with its commit link. Omit sections without items. Use the actual release commits and the previous and current tags; do not publish placeholders or a verification transcript.

```markdown
[Overview paragraph summarizing the release]

## Added
- [Feature description] ([short_sha](https://github.com/Yurzi/dsh-pdf-mineru/commit/full_sha))

## Fixed
- [Bug fix description] ([short_sha](https://github.com/Yurzi/dsh-pdf-mineru/commit/full_sha))

## Changed
- [Change description] ([short_sha](https://github.com/Yurzi/dsh-pdf-mineru/commit/full_sha))

## Removed
- [Removal description] ([short_sha](https://github.com/Yurzi/dsh-pdf-mineru/commit/full_sha))

Full Changelog: https://github.com/Yurzi/dsh-pdf-mineru/compare/v[Previous]...v[Current]
```

## Repository assets

- `docs/assets/` holds the README banner and settings screenshot. They are not packed into the npm package.
- [screenshots.json](screenshots.json) lists the README images used by the awesome-dsh-plugin listing. Keep it in sync when README images change; it is not clutter.
- `assets/icon.svg` and `locale/{en,zh}.json` (`meta.title`, `meta.description`) are the display metadata shown on the DSH Plugins page and in market indexes; they are packed.
