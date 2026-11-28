import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const projectRoot = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig({
  root: projectRoot,
  test: {
    environment: 'node',
    include: ['tests/e2e/**/*.e2e.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    fileParallelism: true,
  },
})
