import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@deepseek-ai/schemastery': 'schemastery',
    },
  },
  test: {
    include: ['tests/**/*.spec.ts'],
    pool: 'forks',
  },
})
