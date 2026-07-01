/**
 * Typed command protocol for driving a tool window's actions from the main
 * process (menus, context menus, and programmatic triggers) over IPC, replacing
 * the older webContents.executeJavaScript('window.X...') seam. Both the main
 * process and the renderers import this module, so a renamed or removed action
 * is a compile error rather than a silent no-op.
 */

/** IPC channel main uses to push a command to a tool window's renderer. */
export const TOOL_WINDOW_COMMAND_CHANNEL = 'tool-window:command'

/**
 * Commands every tool window understands, regardless of which tool it is.
 * `toast` surfaces a transient message (e.g. a CLI file-open failure on an
 * already-open window, where there is no fresh get-initial-data pull to carry it).
 */
export type CommonToolWindowCommand = { type: 'toast'; message: string }

/** Commands the JSON editor renderer handles. */
export type JsonEditorCommand =
    | CommonToolWindowCommand
    | { type: 'newTab' }
    | { type: 'openFile' }
    | { type: 'save' }
    | { type: 'saveAs' }
    | { type: 'closeTab' }
    | { type: 'undo' }
    | { type: 'redo' }
    | { type: 'find' }
    | { type: 'selectAll' }
    | { type: 'jumpToError' }
    | { type: 'format' }
    | { type: 'minify' }
    | { type: 'foldAll' }
    | { type: 'unfoldAll' }
    | { type: 'sortAtCursor' }
    | { type: 'unescapeNested' }
    | { type: 'addTab'; content: string; title?: string }

/** Commands the 9-Patch editor renderer handles. */
export type NinePatchCommand =
    | CommonToolWindowCommand
    | { type: 'new' }
    | { type: 'import' }
    | { type: 'export' }
    | { type: 'undo' }
    | { type: 'redo' }
    | { type: 'importData'; dataUrl: string; isNinePatch: boolean; fileName: string }

/** Commands the SVG converter renderer handles. */
export type SvgConverterCommand =
    | CommonToolWindowCommand
    | { type: 'import' }
    | { type: 'export' }
    | { type: 'loadSvg'; svgText: string; fileName: string; intrinsicWidth: number; intrinsicHeight: number }

/** Any tool-window command (used by the main-side sender). */
export type ToolWindowCommand = JsonEditorCommand | NinePatchCommand | SvgConverterCommand
