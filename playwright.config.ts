import { defineConfig } from '@playwright/test'

export default defineConfig({
    testDir: 'tests/e2e',
    // Only match .spec.ts files under tests/e2e/. Vitest owns the .test.ts files
    // elsewhere under tests/.
    testMatch: '**/*.spec.ts',
    timeout: 60_000,
    // Electron app launch is not parallel-safe (single-instance window state, port binding)
    workers: 1,
    reporter: 'list',
    projects: [
        {
            name: 'electron'
        }
    ]
})
