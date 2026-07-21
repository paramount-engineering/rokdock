# RokDock Build and Release Guide

This document explains how to package RokDock for Windows, macOS, and Linux, how to create a tagged release, and how to run a packaging test without creating tags.

## Prerequisites

- Node.js and npm installed
- Project dependencies installed (see below)
- Run commands from project root: `rokdock/`
- Platform notes:
  - Windows packaging works on Windows
  - macOS packaging works on macOS
  - Linux packaging works on Linux
  - macOS DMG cannot be built on Windows/Linux

## Installing Dependencies

The lockfile (`package-lock.json`) is committed from Windows. To avoid cross-platform lockfile churn:

- On Windows (canonical): `npm install`. This is the primary development platform. Commit lockfile changes from here.
- On macOS/Linux: `npm ci`. This installs exactly what the lockfile specifies without rewriting it, avoiding platform-specific differences (such as `fsevents`) from modifying the lockfile.

## Verification Gate

Before packaging a release, run the full verification suite to catch type errors, lint violations, and test failures:

```bash
npm run verify
```

This runs `typecheck`, `lint`, and the Vitest unit test suite in sequence. Note that `npm run build` (the electron-vite compile step) does not type-check. `npm run verify` is the real gate.

To also run the Playwright end-to-end suite:

```bash
npm run verify:full
```

This runs `verify` first, then `test:e2e`. Both must pass before cutting a release.

## Build Artifacts and Output

- Packaged artifacts are written to `dist/`
- Icon assets are generated from `resources/icon.svg` via `npm run generate-icons`
- The `predist` hook runs icon generation and the electron-vite build automatically before any `dist:*` command

## Standard Packaging Commands

These commands invoke `predist` (icon generation and app build) before packaging.

- Windows: `npm run dist:win`
- macOS: `npm run dist:mac`
- Linux: `npm run dist:linux`
- All targets from a compatible environment: `npm run dist`

## Code Signing and Notarization

macOS signing and notarization are configured to run on CI and are credential-gated. `electron-builder.json` sets `hardenedRuntime: true`, `notarize: true`, and the entitlements file, but no signing identity is hardcoded. electron-builder discovers the certificate from the `CSC_LINK` environment variable. When that variable is absent (any local build, or CI before the secrets are added), electron-builder skips signing and notarization and produces an unsigned build. Adding the secrets switches signing on with no config change.

The signing path uses a **Developer ID Application** certificate (for distribution outside the Mac App Store) plus notarization through Apple's notary service, authenticated with an App Store Connect API key. Both are supplied to the release workflow as repository secrets (see the Continuous Integration section below).

If macOS refuses to launch the app (a Gatekeeper quarantine, common with an unsigned build or any download it flags), clear the quarantine attribute:

```bash
xattr -cr /Applications/RokDock.app
```

A properly signed and notarized build generally launches without this.

`electron-builder.json` references `build/entitlements.mac.plist` for the `hardenedRuntime` entitlements. That file is committed to the repository (it is force-tracked past the `build/*` rule in `.gitignore` via a `!build/entitlements.mac.plist` negation), so `dist:mac` resolves it. It grants `com.apple.security.cs.allow-jit` and `com.apple.security.cs.allow-unsigned-executable-memory` (what an Electron hardened-runtime build needs), plus `com.apple.security.device.camera` and `com.apple.security.device.audio-input` for the HDMI capture feature. The same file is used for both `entitlements` and `entitlementsInherit`, so the renderer/GPU helper processes that actually open the capture stream inherit the camera and audio-input entitlements too. Without that inheritance, capture is blocked even though the top-level app is entitled.

Under `hardenedRuntime` the entitlements alone are not enough: macOS also requires usage-description strings, or it silently denies access with no prompt. `mac.extendInfo` in `electron-builder.json` injects `NSCameraUsageDescription` and `NSMicrophoneUsageDescription` into the packaged `Info.plist`. Note that `npm run dev` does not exercise these: the dev build runs under Electron's own bundle id (`com.github.Electron`), which ships its own camera string, so a signed `dist:mac` build is the only way to validate the capture permission path. Windows and Linux need no packaging changes for capture: Windows gates desktop apps behind a global camera/microphone privacy toggle, and Linux governs device access through `/dev/video*` ownership (the `video` group) and PulseAudio/PipeWire. See the user-facing [HDMI Capture Preview](../user/capture-preview.md) doc for the per-OS troubleshooting steps.

Windows and Linux builds are unsigned.

## File Associations

The `fileAssociations` entries in `electron-builder.json` (`.rscript`, `.rasp`, `.json`, `.svg`) become "Open with RokDock" handlers per platform:

- Windows: the associations are written to the registry by the NSIS installer. The `portable` target has no installer, so by design it registers nothing. A portable app must not modify the user's registry or filesystem. Portable users reach the tools through the in-app Open actions or the CLI (`RokDock --tool <json|svg|ninepatch|script|docs> [path]`). This is intended behavior, not a defect.
- macOS: the associations are declared in the app bundle's `Info.plist` (`CFBundleDocumentTypes`, generated from `fileAssociations`) and registered by Launch Services. An unsigned, quarantined build may not register them until Gatekeeper is cleared (see above).
- Linux: the `.desktop` entry inside the AppImage carries the MIME associations. They register only when the user integrates the AppImage into their desktop environment.

## Per-Tool Launchers

Each tool also gets its own launcher shortcut, alongside the main RokDock entry, so a user can open a tool directly. The set of tools is driven by `src/shared/toolLaunchers.json` (one entry per tool: key, title, badge). Adding a tool there gives it shortcuts on all platforms with no per-platform edits. Developer Docs (`--tool docs`) is part of this set and receives a composed icon and a shortcut on every platform. Like the 9-Patch Editor, Developer Docs has no file association (it opens no files, so no `fileAssociations` entry is needed for it). The `predist` step composes a per-tool icon (the base icon plus a badge) into `build/tool-icons/` and writes the per-platform artifacts via `scripts/generate-launcher-artifacts.cjs`. Each shortcut launches `RokDock --tool <key>`, which opens dock-less straight into that tool.

- Windows: `nsis.menuCategory` puts the main shortcut in a `RokDock` Start Menu folder, and a generated NSIS include (`build/tool-shortcuts.nsh`, referenced by `nsis.include`) adds one shortcut per tool to the same folder. The per-tool `.ico`s ship via `extraResources` to `resources/tool-icons/`. The `portable` target has no installer, so it gets no per-tool shortcuts (same reasoning as file associations).
- macOS: an `afterPack` hook (`build/afterPack.cjs`) builds one wrapper `.app` per tool into a `RokDock Tools` folder, and `dmg.contents` places that folder in the DMG next to RokDock.app. Drag both to Applications. Each wrapper resolves the installed RokDock by bundle id and execs it with `--tool <key>`, so the existing single-instance routing opens the tool whether or not RokDock is already running. If macOS also blocks the Tools wrappers on launch, clear quarantine on the folder too: `xattr -cr "/Applications/RokDock Tools"`.
- Linux: the `deb` target installs per-tool `.desktop` files and icons system-wide (`/usr/share/applications` and `/usr/share/icons/hicolor`), so they appear in the app menu. The AppImage cannot register multiple entries by itself, so it ships `install-tool-shortcuts.sh` (and an uninstall counterpart) as release assets. AppImage users run `install-tool-shortcuts.sh /path/to/RokDock.AppImage` once to add the launchers under `~/.local/share`.

The packaging itself is manual-verify per platform (installer, DMG, deb), consistent with the rest of this guide. The `--tool` launch behavior the shortcuts rely on is covered by the e2e suite.

## Continuous Integration (GitHub Actions)

Installers are built on GitHub runners, not on a developer machine. `.github/workflows/release.yml` builds every platform on its native runner (macOS, Windows, Linux), and electron-builder uploads each platform's installers plus the electron-updater manifests (`latest-mac.yml`, `latest.yml`, `latest-linux.yml`) to the GitHub Release.

The workflow triggers on a `v*` tag push. `npm run release` creates a **draft** release for that tag (`electron-builder.json` sets `publish.releaseType: draft` to match), each runner attaches its assets to that draft, and a final `publish` job publishes it once every platform succeeds. This is required, not just cautious: GitHub's immutable releases feature, enabled on some repos, permanently locks a release's assets the moment it is published, so uploading to an already-published release fails outright there. Publishing last, after every asset is already attached, works regardless of whether that feature is on.

### Required repository secrets

Set these under Settings -> Secrets and variables -> Actions. macOS signing is gated on them: without `CSC_LINK`, the macOS build is produced unsigned and the rest of the workflow still runs.

| Secret | Contents |
|---|---|
| `CSC_LINK` | base64 of the Developer ID Application certificate (`.p12`) |
| `CSC_KEY_PASSWORD` | the password used when exporting that `.p12` |
| `APPLE_API_KEY_B64` | base64 of the App Store Connect API key file (`.p8`) |
| `APPLE_API_KEY_ID` | the API key's Key ID |
| `APPLE_API_ISSUER` | the API key's Issuer ID |

`GITHUB_TOKEN` is provided automatically and is what electron-builder uses to publish the artifacts.

### Pull request CI

A separate workflow, `.github/workflows/ci.yml`, runs the verification gate on every pull request into `main` and on direct pushes to `main`. It runs `npm run build` and then `npm run verify` (typecheck, lint, prose check, and the Vitest unit suite). The build step is required because one integration test spawns the compiled MCP bridge from `out/`, which `verify` on its own does not produce. The Playwright end-to-end suite is not run here because it needs a display. Run `npm run verify:full` locally before cutting a release.

Third-party actions in both `ci.yml` and `release.yml` are pinned to a commit SHA, with the version recorded in a trailing comment, so a moved tag cannot change what runs.

## Create a Tagged Release

Use the guided release script:

```bash
npm run release
```

The script performs:

1. Prompts for version bump: `patch`, `minor`, `major`, `custom`, or `skip`
2. Updates `package.json` version (unless `skip` is used) and creates a release commit
3. Creates the release tag in format `v<major>.<minor>.<patch>`
4. Pushes the commit and tag to `origin`, which triggers the build workflow
5. Creates a **draft** GitHub release with generated notes (via `gh`), for the workflow to attach installers to and publish once every platform succeeds

It does **not** build locally. Publishing the release in step 5 triggers the CI workflow, which builds the installers and attaches them. Track progress with `gh run watch` or the Actions tab. `gh` CLI must be installed and authenticated.

## Skip Version Bump Options

You can skip the version bump in two ways.

### Interactive

At prompt:

```text
Select version bump (patch/minor/major/custom/skip) [patch]:
```

Choose `skip`.

### CLI Flags

The `--` before flags is required. It tells npm to pass the flag to the script instead of interpreting it as an npm option.

```bash
npm run release -- --skip-version-bump
```

or

```bash
npm run release -- --no-bump
```

When skipping version bump:

- `package.json` remains unchanged
- no release commit is created
- release tag is still created from current version

## Create GitHub Release from Existing Build

If a tag already exists (from a previous `npm run release`) and you just need to create or recreate the GitHub release with assets from `dist/`:

```bash
npm run release -- --release-only
```

This skips the version bump, build, packaging, and tagging steps. It finds installer artifacts in `dist/` matching the current `package.json` version and uploads them to a new GitHub release on the existing tag.

## Test Run Without Tagging a Release

For packaging test runs that do not create commit/tag history, run packaging scripts directly:

- `npm run dist:win`
- `npm run dist:mac`
- `npm run dist:linux`

These commands produce install artifacts in `dist/` without modifying git history.

## Optional Manual Verification Checklist

- App launches from packaged artifact
- Main window, remote panel, settings open normally
- Terminal connection and device discovery work
- Version displayed in app is expected
- Artifact names match expected patterns:
  - `RokDock-<version>-Setup-win-x64.exe`
  - `RokDock-<version>-Portable-win-x64.exe`
  - `RokDock-<version>-mac-<arch>.dmg`
  - `RokDock-<version>-mac-<arch>.zip`
  - `RokDock-<version>-linux-x64.AppImage`
  - `RokDock-<version>-linux-x64.deb`
