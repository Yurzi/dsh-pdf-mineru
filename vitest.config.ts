import { defineConfig } from 'vitest/config'

// Two projects share one invocation (`pnpm test`):
// - unit: source-plane specs; never import the built lib/.
// - package: specs under tests/package/ that load the built lib/ bundle or the
//   packed artifact; they require `pnpm run build` first (`pnpm run check`
//   orders typecheck → build → test). Select one with `vitest run --project <name>`.
export default defineConfig({
  test: {
    pool: 'forks',
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['tests/**/*.spec.ts'], exclude: ['tests/package/**'] },
      },
      {
        extends: true,
        test: { name: 'package', include: ['tests/package/**/*.spec.ts'], testTimeout: 20_000 },
      },
    ],
  },
})
