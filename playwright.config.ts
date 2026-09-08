import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4390'
  },
  webServer: {
    command: 'node dist/cli/index.js serve --port 4390 --no-open',
    url: 'http://127.0.0.1:4390/health',
    reuseExistingServer: false,
    cwd: '.'
  }
})
