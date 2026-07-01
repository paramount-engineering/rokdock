# Getting Started

RokDock is a desktop app for Roku development workflows: device discovery, terminal sessions, remote control, deeplinks, and JSON inspection.

## Requirements

- Node.js 20+ and npm (for source/developer usage, where the Vite 7 toolchain requires Node 20.19+ or 22.12+)
- Supported desktop platforms:
  - Windows (NSIS installer, portable EXE)
  - macOS (DMG, ZIP)
  - Linux (AppImage)

## Install From Artifacts

Use a packaged build from `dist/`:

- Windows:
  - `RokDock-<version>-Setup-win-x64.exe` (installer)
  - `RokDock-<version>-Portable-win-x64.exe` (portable)
- macOS:
  - `RokDock-<version>-mac-<arch>.dmg`
  - `RokDock-<version>-mac-<arch>.zip`
- Linux:
  - `RokDock-<version>-linux-x64.AppImage`

## Run From Source

```bash
npm install
npm run dev
```

To build production bundles only:

```bash
npm run build
```

## First Launch

- RokDock shows a boot splash while loading app state.
- The splash is displayed for at least 1 second to avoid flicker.
- On load, RokDock restores:
  - panel layout (left/right open state)
  - saved settings and preferences
  - discovered/manual devices
  - nickname and auth metadata
  - window size, position, and maximized state

## Main layout

![The RokDock workspace: the device panel, AI Chat panel, and docked HDMI capture preview on the left, a tabbed BrightScript debug terminal in the center, and the Remote / Scripts / Deeplinks control rail on the right](images/workspace-overview.webp)

RokDock arranges its workspace around a top menu bar and a set of panels:

- **Device panel (left).** Discovered and manually-added devices, with connect actions, refresh, and add-device controls. See [Devices](devices.md).
- **Terminal workspace (center).** Tabbed telnet terminal sessions. Before you connect a device it shows a "No Active Connections" prompt. See [Terminal](terminal.md).
- **Control rail (right).** The virtual [Remote](remote-control.md), saved automation [Scripts](script-editor.md), and the [Deeplinks](deeplinks.md) launcher.
- **AI Chat (Beta).** A dockable assistant that appears once you configure an AI provider. It can sit in the left column, in the right rail, or as a drawer below the terminal. See [AI Chat](ai.md).
- **Capture preview.** A live HDMI [capture](capture-preview.md) feed, shown when a capture device is configured in Settings. It can dock in either side column, float as a Picture-in-Picture overlay, or open in its own window.

The menu bar also holds the theme toggle and the panel-toggle buttons, and both side panels can be collapsed and reopened from their edge triggers or the View menu.

## Auxiliary Windows

RokDock can open additional windows for specific tools:

- **Screenshot Preview** - capture and inspect device screenshots with zoom, overlays, and measurement tools
- **JSON Viewer** - view structured JSON detected in terminal output
- **Script Editor** - create and run automation scripts against Roku devices
- **9-Patch Editor** - create and edit 9-patch images for Roku SceneGraph
- **SVG Converter** - convert SVG files to quantized PNG for Roku assets
- **Developer Docs** - browse the official Roku developer documentation in-app

Auxiliary windows follow the current app theme and close automatically when the main window closes.

## Launching Tools Directly

The tools also open on their own, without going through the dock:

- **Per-tool shortcuts.** The installer adds a shortcut for each tool alongside the main RokDock entry: a **RokDock** folder in the Windows Start Menu, application-menu entries on Linux, and wrapper apps on macOS. Each opens straight into its tool (JSON Editor, SVG Converter, 9-Patch Editor, Script Editor). The Windows portable build has no installer, so it adds no shortcuts.
- **File associations.** Double-clicking a recognized file opens the matching tool: a `.json` file opens the JSON Editor, `.svg` opens the SVG Converter, and `.rasp` or `.rscript` open the Script Editor. Associations are opt-in and set up during install. 9-Patch files are intentionally not associated: open the 9-Patch Editor from the dock or its shortcut and import the image.
- **Command line.** `RokDock --tool <json|svg|ninepatch|script|docs> [path]` opens a single tool, optionally loading a file (where applicable). A relative path resolves against the current directory. Developer Docs (`--tool docs`) and the 9-Patch Editor (`--tool ninepatch`) have no file association and accept no path argument.

A tool launched this way runs in its own window and can coexist with the same tool opened from the dock. The standalone JSON Editor also remembers its open tabs and unsaved work between launches (see [JSON Viewer](json-viewer.md)).

## Capture Preview

RokDock can display a live video feed from an HDMI capture device. The capture preview can be docked in a side panel, floated as a PiP overlay, or opened in a separate window. Configure the capture device in **Settings > Capture**. See [Capture Preview](capture-preview.md) for details.

## AI Chat (Beta)

RokDock has an opt-in AI assistant. After you configure a provider in **Settings > AI (Beta)**, an AI Chat panel becomes available (dockable on the left, middle, or right) and an "Explain this" action appears for terminal selections. AI is off until a provider is configured. See [AI Chat](ai.md) for details.

## Open Common Screens

- Settings: `File > Settings...` or `Ctrl/Cmd + ,`
- About: `Help > About RokDock`
- Check for updates: `Help > Check for Updates...`
- New connection flow: `File > New Connection...` or `Ctrl/Cmd + T`
- Screenshot preview: camera button in Remote panel
- Script Editor: `Tools > Script Editor`
- 9-Patch Editor: `Tools > 9-Patch Editor`
- SVG Converter: `Tools > SVG Converter`
- Developer docs: `Tools > Developer Docs`

## Updating RokDock

RokDock checks for updates automatically once each time it launches, and you can check any time from `Help > Check for Updates...`. Results appear in an in-app dialog:

- **A new version is available.** Choose **Download & Install** to download the update and restart into the new version.
- **Up to date.** You are already on the latest version.
- **Could not check.** The update service could not be reached. Try again later.

The automatic launch check is silent unless an update is available, in which case the dialog opens on its own. Update checking is active only in installed builds. Running from source always reports up to date.
