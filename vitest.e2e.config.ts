import { defineConfig } from 'vitest/config'

// End-to-end suite against a real, isolated DSH install (see CONTRIBUTING.md,
// "End-to-end tests"). Slow and networked on first run; not part of `pnpm run check`.
export default defineConfig({
  test: {
    include: ['e2e/**/*.e2e.ts'],
    globalSetup: ['e2e/global-setup.ts'],
    pool: 'forks',
    // The files share one profile and one DSH home; the GUI suite writes to them.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 900_000,
  },
})
