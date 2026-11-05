import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  // The tests share one seeded store: one action at a time.
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4390'
  },
  webServer: {
    // A throwaway repository with seeded artifacts; needs `pnpm run build` first.
    command: 'node tests/e2e/fixture-server.ts',
    url: 'http://127.0.0.1:4390/health',
    reuseExistingServer: false,
    cwd: '.'
  }
})
