# JSON Viewer

The JSON Viewer is a tabbed code editor for reading, editing, and saving JSON. It is backed by CodeMirror 6 with JSON syntax highlighting, line numbers, code folding, inline parse-error markers, and a persistent status bar.

![JSON Viewer window showing a tab bar with an untitled-1 tab and a new-tab button, a toolbar with new, open, save, save-as, format, minify, expand-all, collapse-all, and sort buttons, a CodeMirror editor with JSON syntax highlighting and line numbers, and a status bar showing line/column, byte size, UTF-8, and the JSON parse status](images/json-editor.png)

*The JSON Viewer window with a single untitled tab, the full toolbar, and the status bar.*

## Opening the Viewer

**From terminal output:** Click a detected JSON segment in the terminal. The Viewer opens with that JSON already loaded in a new tab.

**From the dock:** Open `Tools > JSON Editor`. The editor starts with a new empty tab and shows a placeholder ("Open a file or paste JSON") with the available entry-point hints until content is entered.

**As a standalone tool:** The JSON Editor also opens on its own, outside the dock, via its installer shortcut, by double-clicking a `.json` file, or with `RokDock --tool json [path]`. See [Launching Tools Directly](getting-started.md#launching-tools-directly). A standalone editor remembers its work between launches (see [Session Persistence](#session-persistence) below).

## Window Behavior

- Opens in a separate auxiliary window.
- Default size: 960x720 pixels (minimum 640x440).
- Inherits the current app zoom level for visual consistency.
- Tracks the active light/dark theme and responds to live theme switches without reopening.
- When opened from a terminal JSON click, syntax token colors are seeded from the active terminal syntax theme.
- Only one JSON Viewer window exists at a time. If the window is already open, a new JSON click adds a tab rather than opening a second window.

## Session Persistence

When the JSON Editor runs as a standalone tool, it remembers your work across restarts. The next time you launch it, your open tabs come back, including untitled buffers and any unsaved edits to files you had open.

A few details worth knowing:

- Recovered drafts are kept in a private recovery cache. Your actual files on disk are never touched until you explicitly save, so reopening the editor never overwrites a file behind your back.
- Saved tabs with no pending edits are not recreated as drafts. Only untitled buffers and unsaved changes are restored.
- The JSON Editor opened from the dock (`Tools > JSON Editor`) is transient. It does not persist between sessions, and it closes with the main window.

## Placeholder Overlay

When the active tab is empty and unmodified, a centered overlay reads "Open a file or paste JSON" with the platform-appropriate shortcut hint (Cmd+O / Ctrl+O to open a file, Cmd+V / Ctrl+V to paste). The overlay disappears as soon as content is present.

## Tab Bar

- Each open document occupies a tab. Tabs are labeled by filename or "untitled-N" for new unsaved buffers.
- An unsaved change is indicated by a filled dot on the tab label.
- Click a tab to switch to it. Middle-click closes it.
- Click the "+" button at the right end of the tab bar to open a new empty tab.
- Closing a tab with unsaved changes triggers a dialog with "Don't Save", "Cancel", and "Save" options.

## Toolbar

Buttons from left to right:

| Button | Action |
|---|---|
| New | Open a new empty tab |
| Open | Open a native file dialog (JSON, JSONC, JSON5, all files) |
| Save | Save the active tab to its current file path; shows Save As dialog if the tab is unsaved |
| Save As | Save the active tab via a native Save dialog |
| Format JSON | Pretty-print the JSON with 2-space indentation |
| Minify JSON | Collapse the JSON to a single line |
| Expand all | Unfold every collapsed object and array in the editor |
| Collapse all | Fold every collapsible object and array in the editor |
| Sort Keys at Cursor | Sort the keys of the nearest enclosing object at the cursor position (or sort a primitive array) |

Collapsed objects and arrays show a child-count badge (for example `{ ... 3 }`) so you can see how much is hidden.

Format and Minify both show a toast if the content is not valid JSON, and the message names the error location (for example "Invalid JSON at Ln 4, Col 2 - cannot format"). If the document contained duplicate keys, a toast notes that the duplicates were merged (the last value wins), since re-serializing JSON drops repeated keys.

## Keyboard Shortcuts

These shortcuts are defined in the application menu and apply when the JSON Viewer window has focus.

| Shortcut | Action |
|---|---|
| Cmd/Ctrl+N | New tab |
| Cmd/Ctrl+O | Open file |
| Cmd/Ctrl+S | Save |
| Cmd/Ctrl+Shift+S | Save As |
| Cmd/Ctrl+W | Close active tab |
| Cmd/Ctrl+Z | Undo |
| Cmd/Ctrl+Shift+Z (Mac) / Ctrl+Y (Windows) | Redo |
| Cmd/Ctrl+F | Find (CodeMirror search panel) |
| Cmd/Ctrl+A | Select all |
| Cmd/Ctrl+C | Copy selection |
| Cmd/Ctrl+V | Paste |

## Copy Behavior

Standard Cmd/Ctrl+C copies the current text selection. The context menu exposes a Copy item that is enabled only when text is selected. To copy the entire document, use Select All first.

## Status Bar

The status bar at the bottom of the window shows four fields:

- **Ln N, Col N** - current cursor line and column (1-based)
- **byte size** - size of the active tab's content as B, KB, or MB
- **UTF-8** - encoding indicator (always UTF-8)
- **parse status** - reads **JSON** when the document parses cleanly. When it does not, it turns into an error label such as **Error Ln 4, Col 2** in the error color. Clicking that label jumps the cursor to the first parse error. Bad JSON is also marked inline (an underline with a hover message) and in the gutter.

## Jump to Error

When the document has a parse error, the parse-status field in the status bar shows its location and is clickable. You can also run **Jump to Error** from the Edit menu or the context menu to move the cursor to the first error from anywhere in the document.

## Unescape Nested JSON

Roku payloads often embed a JSON document as an escaped string value inside another JSON document, for example `{"payload": "{\"a\":1}"}`. Place the cursor inside such a string (or select it) and run **Unescape Nested JSON** from the View menu or the context menu. The decoded, formatted JSON opens in a new tab, leaving the original document untouched. If the cursor is not on a string whose contents are themselves JSON, a toast reports that there is no nested JSON at the cursor.

## Context Menu

Right-clicking inside the editor opens a context menu with Undo, Redo, Cut (enabled when text is selected), Copy (enabled when text is selected), Paste, Select All, Format JSON, Minify JSON, Fold All, Unfold All, Sort Keys at Cursor, Unescape Nested JSON, and Jump to Error.

## Theme Integration

The Viewer inherits the current RokDock theme. When the app switches between light and dark mode, the editor updates without requiring a reload. When opened from a terminal JSON click, syntax token colors are seeded from the active terminal syntax theme palette so the JSON colors match the terminal context.

## Tips

- Use Format JSON after pasting minified output to make large payloads readable.
- Use Sort Keys at Cursor to normalize key order before diffing two JSON payloads.
- Middle-click a tab to close it quickly.
- Open multiple files in separate tabs to compare them side by side without leaving the window.
