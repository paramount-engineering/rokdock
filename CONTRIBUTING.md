# Contributing to RokDock

RokDock is an Apache-2.0 licensed desktop app for Roku development. Contributions are welcome. This guide covers what you need to get set up and what is expected before opening a pull request.

## Prerequisites

- **Node.js 18 or newer** (check with `node --version`)
- **npm** (bundled with Node.js)
- The app primarily targets **Windows**. macOS and Linux are best-effort and should still build and run, but Windows is the primary test surface.

## Setup

Clone the repo and install dependencies with `npm ci` rather than `npm install`. The `ci` command installs exactly what is recorded in `package-lock.json` and will not silently update it.

```bash
npm ci
```

Only use `npm install` when you are intentionally adding or updating a dependency.

## Development

Start the app in development mode (hot-reload via electron-vite):

```bash
npm run dev
```

## Building and Packaging

Build the renderer and main process bundles:

```bash
npm run build
```

Note that `npm run build` does **not** run the type-checker. It will succeed even if there are TypeScript errors. Run `npm run verify` (see below) to catch type errors.

Package a distributable installer:

```bash
npm run dist:win     # Windows
npm run dist:mac     # macOS
npm run dist:linux   # Linux
```

Each `dist:*` command runs the build and icon generation steps automatically before packaging.

## Verification Gate

Before opening a pull request, the full verification suite must pass:

```bash
npm run verify
```

This runs the TypeScript type-check (`tsc --noEmit`), ESLint, and the Vitest unit and integration test suite. All three must be green.

If your change touches UI flows or Electron lifecycle behavior, also run the Playwright end-to-end suite:

```bash
npm run verify:full
```

`verify:full` runs everything in `verify` plus the Playwright-Electron E2E tests. This takes longer and requires a working build, but catches regressions that unit tests cannot.

**Do not open a PR with a failing `npm run verify`.** If `verify:full` is not feasible in your environment (for example, due to display or driver constraints), note that explicitly in the PR description.

## Code Conventions

**Naming.** Exported symbols (classes, React components, TypeScript types/interfaces) use PascalCase. File names and folder names use camelCase (`myFeature.ts`, not `MyFeature.ts` or `my-feature.ts`).

**Styling.** The app uses a shared design token system. Always consume the `--rokdock-*` CSS custom properties and the components from `rokdock-controls` rather than hardcoding colors, spacing, or control styles. Do not hand-roll UI elements that already exist as shared components.

**Process boundary.** The Electron main process (`src/main`) must not import code from `src/renderer`. Shared constants needed by both processes belong in `src/shared` as standalone files with no renderer imports.

**Architecture.** Fit into the existing layering. Logic belongs in the layer that owns it. Avoid ad-hoc coupling between layers.

## Tests

Add or update tests for any behavioral change. The test suite covers device-facing protocol logic using in-process fakes (no real Roku device is required to run the suite). Real-device behavior is verified separately. When adding new services or IPC handlers, follow the same pattern: fake the network boundary and test the logic in isolation.

## Opening a Pull Request

- Keep changes focused. One logical change per PR is easier to review and revert.
- Run `npm run verify` and confirm it is green before pushing.
- Write a clear description of what the change does and why.
- Reference any related issue with `Fixes #N` or `Related to #N`.

Questions or ideas? Open an issue first for anything significant so the approach can be discussed before you invest in implementation.
