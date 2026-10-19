# Contributing

This guide covers local setup, tests, end-to-end tests, manual verification, DSH baseline upgrades and releases. Module boundaries live in [ARCHITECTURE.md](ARCHITECTURE.md); standing rules for agents and reviewers live in [AGENTS.md](AGENTS.md).

## Setup

- Node.js `^22.19.0 || >=24.0.0` and the pnpm version named by `packageManager` in [package.json](package.json).
- `pnpm install` installs into a workspace-local store (`.pnpm-store/`, see [pnpm-workspace.yaml](pnpm-workspace.yaml)). DSH host packages are pinned exactly in `devDependencies` and `autoInstallPeers` is off, so the compiler sees one copy of each.
- Generated output (`lib/`) is not committed. Run `pnpm run build` before installing the checkout into DSH with `link:` and before any smoke script; `test:e2e` builds for you.

## Scripts

| Script | Purpose |
| --- | --- |
| `pnpm run check` | Lint, typecheck, build, then test. CI runs this on every push to `main` and every pull request |
| `pnpm run lint` | oxlint correctness rules over `src`, `tests`, `e2e`, `build` and `scripts` |
| `pnpm run typecheck` | Node program (`tsconfig.json`), browser program (`tsconfig.client.json`) and tests, including `e2e/` (`tsconfig.test.json`) |
| `pnpm run build` | Clean `lib/` and build the host bundle, the client bundle and the copied PDF.js worker with tsdown |
| `pnpm run watch` | tsdown watch mode |
| `pnpm test` | Run all Vitest projects once |
| `pnpm run test:watch` | Vitest watch mode |
| `pnpm run test:e2e` | Build, then run the [end-to-end tests](#end-to-end-tests) in an isolated real DSH. Not part of `check` |
| `pnpm run smoke:reader-local` | Manual offline original-page smoke through the built tool chain |
| `pnpm run smoke:official-v4` | Manual live parse against the official API (uploads the PDF) |

Also run `git diff --check` before handing off a change.

## Tests

Vitest runs two projects from one `pnpm test` invocation (see [vitest.config.ts](vitest.config.ts)):

- **unit**: source-level specs. They never import `lib/`.
- **package**: specs that load the built `lib/` bundle or a packed artifact. They need a fresh build first; `pnpm run check` orders that for you. Run one project with `pnpm exec vitest run --project unit`.

Shared fakes and harnesses (HTTP fake, provider context, reader and tool harnesses, storage fixtures) live in `tests/support/`. Reuse them instead of building new mocks per spec.

Policy:

- Unit and package tests are mock- or fixture-based and never touch the network or a real MinerU service.
- Cover behavior at trust and failure boundaries: failure and cancellation paths, retry exhaustion, `Retry-After`, no replay of unsafe POSTs, credential placement, ZIP and path safety, concurrency and cross-process locking, persistence and migration, maintenance fail-closed behavior and confirmations, renderer and output limits, cursor continuation, and the model-visible output.
- Prefer one real composition (real ParseService/ReaderService over a fake provider, real Settings/ConfigEditor) over many assertions that a dependency was called.
- Do not test version pins beyond the package contract check, prose wording that is not a contract, removed APIs, or obvious branches. Delete tests for code you delete.

## End-to-end tests

`pnpm run test:e2e` builds and packs the plugin, installs it into a real, isolated DSH, and checks what unit tests cannot: the installed package inside the real composition, and the settings page in a real `dsh web`. It is not part of `pnpm run check`. Each file under [e2e/](e2e/) opens with a comment on what it covers and why.

| File | Checks |
| --- | --- |
| [global-setup.ts](e2e/global-setup.ts) | `dsh plugin add <tarball>` succeeds: the plugin manager accepts `engines.dsh` and installs the production dependencies |
| [host.e2e.ts](e2e/host.e2e.ts) | `dsh --profile web --dump-config` has the `dsh-pdf-mineru` row with the first-boot defaults of [cordis.patch.yml](cordis.patch.yml). Booted in-process, the profile loads the installed package, resolves `pdfjs-dist`, `@napi-rs/canvas` (with its platform binary) and `yauzl` inside the profile, mounts the plugin on the composition's `tools`, `jobs`, `settings` and `workingDirectory`, and registers both tools. A real `read_pdf` page view with an empty `PATH` renders a generated PDF into a valid PNG through the installed PDF.js worker and Canvas |
| [web.e2e.ts](e2e/web.e2e.ts) | In `dsh web` with headless Chromium: localized title and icon; the page sits in the bundle detail, not in global Settings; configuration loads through the owner-only, loopback-Host RPC without refusals; drafts survive tab switches; a save changes the dumped configuration; a stale save in a second tab is refused (`mineru/conflict`) and Reload shows the other tab's value; the API key lands only in `$DSH_HOME/.credentials.yaml`; the connection test reaches a local fake MinerU and reports an unreachable one; a seeded cache result appears under Storage and is deleted after preview and confirmation; no browser console errors |

GUI tests restore the effective configuration they change. No test reaches MinerU or any other external service; the network is used only to install DSH and the plugin's dependencies. Model conversations are out of scope (no mock LLM installs into a profile); nested `run_code` calls are covered by `tests/composition.spec.ts`.

**Isolation.** Everything a run writes goes to `.e2e/run`, recreated at the start of each run: `DSH_HOME`, `HOME`, `XDG_*`, `TMPDIR`, `DSH_AGENTS_HOME`, `DSH_BUNDLED_SKILL_DIR`, the npm cache and the pnpm store. Inherited `DSH_*`, `MINERU_*`, `DEEPSEEK_*`, `NODE_ENV` and `NODE_OPTIONS` are cleared and telemetry is off; proxy variables pass through. `dsh web` listens on a random free loopback port, and the in-process boot drops the rows that would bind one ([host-plane.yml](e2e/fixtures/host-plane.yml)). A run never reads or writes `~/.dsh`, a running DSH, or port 3080.

**DSH under test.** The lower bound of `engines.dsh`. The CLI, which brings its own Web GUI, is installed with npm into `.e2e/dsh-<version>` on first use and reused afterwards. npm keeps your registry settings but uses `.e2e/npm-cache`, four sockets, extra fetch retries and up to three attempts, because registry connection resets are common for an install of this size; a failure says whether the network was the cause. The in-process boot uses the CLI's building blocks from `@deepseek-ai/dsh-app-boot` rather than a public embedding API; only [support/host.ts](e2e/support/host.ts) touches them.

**Running.**

```sh
pnpm run test:e2e
```

Every run installs the plugin's production dependencies from the registry, so it needs network access. The first run also installs DSH (about 800 MB) and takes a few minutes; later runs take one to two minutes.

| Variable | Effect |
| --- | --- |
| `DSH_E2E_INSTALL` | Existing directory whose `node_modules` holds `@deepseek-ai/dsh` at the tested version; skips the install |
| `DSH_E2E_CHROMIUM` | Chromium or Chrome executable. Otherwise `/usr/bin/chromium`, `/usr/bin/chromium-browser` and `/usr/bin/google-chrome` are tried; without one, `web.e2e.ts` is skipped |

**Artifacts.** Screenshots for people to review (desktop, 390 px and dark; never compared) and `console-errors.json` go to `.e2e/artifacts/`. The `dsh web` output is `.e2e/run/web.log`, and the test profile stays in `.e2e/run/home/profiles/web/` until the next run. `.e2e/` is ignored by git.

**When to run.** Locally, after changing `src/client/`, after upgrading the DSH baseline, and before a release. CI does not run it.

## Manual verification

Keep smoke output and other evidence under the ignored `.vitest-cache/` directory; never commit it. The settings page and the installed package are covered by the [end-to-end tests](#end-to-end-tests).

**Original-page rendering** (no upload):

```sh
pnpm run smoke:reader-local -- /absolute/path/sample.pdf 1 --backend=auto
pnpm run smoke:reader-local -- /absolute/path/sample.pdf 1 .vitest-cache/pdfjs --backend=pdfjs
```

`--backend=pdfjs` gives the plugin an empty `PATH` for this run only, proving the automatic PDF.js fallback. `--expect-renderer=poppler|pdfjs` asserts the renderer that was used. Real-document checks should include embedded CJK fonts, math, two-column and rotated pages, and transparency; look at the images.

**Live official API** (explicit opt-in; uploads the document and spends quota):

```sh
MINERU_API_KEY=<token> pnpm run smoke:official-v4 -- /absolute/path/sample.pdf
```

## Upgrading the DSH baseline

1. Read the host's upgrade-guide entries (`docs/upgrade-guide/<version>/` in the DeepSeek Harness repository) for every release between the old and new baseline.
2. In [package.json](package.json): set `engines.dsh` to the new range (it alone decides compatibility), set every `@deepseek-ai/dsh-*` peer to the same range, and pin every `@deepseek-ai/dsh-*` dev dependency to the exact lower bound. Align the `cordis`, `cosmokit` and `schemastery` ranges with the host. The package contract test enforces peers == `engines.dsh` and dev pins == its lower bound.
3. Run `pnpm install`, then `pnpm run check` and `pnpm run test:e2e`, which installs the new lower bound. If the host changed how the CLI boots a profile, adjust [e2e/support/host.ts](e2e/support/host.ts); check the row ids in [e2e/fixtures/host-plane.yml](e2e/fixtures/host-plane.yml) against `dsh --profile web --dump-config`.
4. Add a CHANGELOG entry. Prose outside CHANGELOG and the README requirement line must not name DSH versions.

## Release

The following steps are the authorized release operator's workflow, not permission for an agent doing documentation or verification work to commit, push, tag, publish, or create a release. Obtain explicit authorization for those side effects.

1. **Version bump**: update `"version"` in `package.json`.
2. **Update maintained docs**: rename `## Unreleased` in CHANGELOG.md to `## X.Y.Z` (Keep a Changelog categories: `### Added`, `### Changed`, `### Fixed`, `### Removed`), and reconcile README.md, docs/configuration.md, docs/model-reading.md, ARCHITECTURE.md, AGENTS.md and this file with current behavior.
3. **Verification**: `pnpm run check && git diff --check && pnpm run test:e2e`.
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