import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
    plugins: [react()],
    test: {
        environment: 'node',
        // Unit/integration tests live under tests/, mirroring the src/ hierarchy.
        // (Playwright owns tests/e2e/*.spec.ts; the .test.ts vs .spec.ts split keeps
        // the two runners from picking up each other's files.)
        // .tsx covers React component tests (e.g. chatMarkdown); .ts covers the rest.
        include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
        // Integration tests bind real localhost ports (e.g. the fake ECP server on
        // the fixed ECP port). Running test files serially prevents port collisions
        // and cross-file timing races. The suite is fast enough that this is free.
        fileParallelism: false
    },
    resolve: {
        alias: {
            '@main': path.resolve(__dirname, 'src/main'),
            '@preload': path.resolve(__dirname, 'src/preload'),
            '@renderer': path.resolve(__dirname, 'src/renderer'),
            '@shared': path.resolve(__dirname, 'src/shared'),
            '@ai-core': path.resolve(__dirname, 'src/ai-core')
        }
    }
})
