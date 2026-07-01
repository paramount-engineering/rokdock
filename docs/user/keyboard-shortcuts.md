# Keyboard Shortcuts

This page lists user-facing keyboard shortcuts in RokDock.

## Platform Notes

- `Cmd` applies on macOS.
- `Ctrl` applies on Windows and Linux.

## Application Menu (Global)

### File

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + T` | New Connection (opens the Devices panel) |
| `Ctrl/Cmd + ,` | Open Settings |

### Edit

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Shift + Z` | Redo |
| `Ctrl/Cmd + X` | Cut |
| `Ctrl/Cmd + C` | Copy |
| `Ctrl/Cmd + V` | Paste |
| `Ctrl/Cmd + A` | Select All |

### View

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + Shift + D` | Toggle Devices panel |
| `Ctrl/Cmd + Shift + R` | Toggle Remote panel |
| `Ctrl/Cmd + =` | Zoom in |
| `Ctrl/Cmd + -` | Zoom out |
| `Ctrl/Cmd + 0` | Reset zoom |
| `Ctrl + scroll` | Zoom in/out |

## Terminal

### Search

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + F` | Open search |
| `Enter` (in search box) | Next match |
| `Shift + Enter` (in search box) | Previous match |
| `Escape` (in search box) | Close search |

### Input and Control

| Shortcut | Action |
|----------|--------|
| `Enter` (command input) | Submit command |
| `ArrowUp` (command input) | Previous command history item |
| `ArrowDown` (command input) | Next command history item |
| `Alt + C` | Clear terminal output |
| `Ctrl/Cmd + C` | Copy selected text, or send interrupt (`^C`) when nothing is selected |

### Context Menu Accelerators

These accelerators appear in the terminal right-click menu.

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + Shift + C` | Copy |
| `Ctrl/Cmd + Shift + V` | Paste |
| `Ctrl/Cmd + A` | Select All |
| `Ctrl/Cmd + F` | Find |

## Remote Panel Keyboard Control

When the remote panel is focused, key bindings map to Roku remote actions.

Default bindings:

| Key | Remote action |
|-----|---------------|
| `Escape` | Back |
| `Home` | Home |
| `ArrowUp` | Up |
| `ArrowDown` | Down |
| `ArrowLeft` | Left |
| `ArrowRight` | Right |
| `Enter` | OK / Select |

All other remote buttons (Power, Rewind, Play/Pause, Fast Forward, Volume, Mute, Instant Replay, Options) have no default key binding. You can assign them in **Settings > Remote**.

## Screenshot Preview

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + C` | Copy screenshot (no overlay) |
| `Ctrl/Cmd + Shift + C` | Copy screenshot with overlay |
| `Ctrl + scroll` | Zoom in/out |

## JSON Editor

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + N` | New tab |
| `Ctrl/Cmd + O` | Open file |
| `Ctrl/Cmd + S` | Save |
| `Ctrl/Cmd + Shift + S` | Save As |
| `Ctrl/Cmd + W` | Close tab |
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl + Y` / `Cmd + Shift + Z` | Redo (Windows/Linux / macOS) |
| `Ctrl/Cmd + F` | Find |

## 9-Patch Editor

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + N` | New |
| `Ctrl/Cmd + O` | Import image |
| `Ctrl/Cmd + S` | Export 9-patch |
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl + Y` / `Cmd + Shift + Z` | Redo (Windows/Linux / macOS) |
| `Ctrl + scroll` | Zoom in/out |

## SVG Converter

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + O` | Import SVG |
| `Ctrl/Cmd + S` | Export PNG (enabled after an SVG is loaded) |
| `Ctrl + scroll` | Zoom in/out |

## Developer Docs

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + K` | Quick open (filter the doc tree by title) |
| `Alt + Left` | Back |
| `Alt + Right` | Forward |
| `F3` | Next search match |
| `Shift + F3` | Previous search match |
| `Escape` (in search box) | Clear the search box |
| `Enter` (in search box) | Open the first result |
| `Ctrl/Cmd + =` / `-` / `0` | Zoom the reading text in / out / reset |

The mouse back/forward buttons also navigate history.

## App Menu Notes

- Native Electron Alt menu activation is suppressed to avoid accidental menu focus while using terminal controls.

## Related

- [Settings](settings.md) - binding customization and other preferences
- [Terminal](terminal.md) - detailed search and command behavior
- [Remote Control](remote-control.md) - remote focus behavior
- [Screenshot Preview](screenshot-preview.md) - preview window features
- [Script Editor](script-editor.md) - automation script editor
- [SVG Converter](svg-converter.md) - SVG to PNG converter
- [9-Patch Editor](ninepatch-editor.md) - editor features
- [Developer Docs](developer-docs.md) - in-app documentation browser
- [AI Chat](ai.md) - the AI assistant (Enter to send, Shift+Enter for newline)
