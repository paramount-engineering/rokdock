import { bootBundledTheme } from '@shared/entryBootstrap'
import './appearanceModalTrigger'
import type { JsonEditorCommand } from '@shared/toolWindowCommands'
import type { JsonSessionSnapshot, JsonRestoredSession } from '@shared/jsonSession'
import { isLightTheme } from '@shared/themeBoot'
import { escapeHtml } from '@shared/htmlEscape'
import { generateId } from '@shared/generateId'
import { createToast } from '@shared/toast'
import './jsonEditor.css'
import type { AppearanceDraft } from '@shared/appearanceDraft'

// Apply theme vars and await fonts before the body is revealed. init() awaits
// this so the theme class is on documentElement before it resolves the syntax
// theme (resolveSyntaxTheme is mode-dependent for the none/custom presets).
const themeReady = bootBundledTheme()

import {
    faArrowDownAZ,
    faBars,
    faBarsStaggered,
    faFile,
    faFileArrowDown,
    faFloppyDisk,
    faFolderOpen,
    faMinus,
    faPlus,
    faXmark,
} from '@fortawesome/free-solid-svg-icons'
import { faSvg } from '@shared/icons'
import { EditorState, Compartment, Prec } from '@codemirror/state'
import type { Extension, Text } from '@codemirror/state'
import {
    EditorView,
    keymap,
    lineNumbers,
    highlightActiveLine,
    highlightActiveLineGutter,
    drawSelection,
    dropCursor,
    scrollPastEnd,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, undo, redo, selectAll } from '@codemirror/commands'
import {
    foldGutter,
    codeFolding,
    foldKeymap,
    foldAll,
    unfoldAll,
    indentUnit,
    bracketMatching,
    indentOnInput,
    syntaxTree,
} from '@codemirror/language'
import { search, searchKeymap, openSearchPanel } from '@codemirror/search'
import { json, jsonParseLinter } from '@codemirror/lang-json'
import { linter, lintGutter, forEachDiagnostic } from '@codemirror/lint'
import type { Diagnostic } from '@codemirror/lint'
import { buildJsonEditorTheme, foldMarkerDOM } from './jsonEditorTheme'
import { resolveSyntaxTheme } from './styles/terminalSyntaxThemes'
import type { TerminalSyntaxThemePreset } from './styles/terminalSyntaxThemes'
import { formatJson, minifyJson, findEnclosingSpan, sortJsonValue, reindentJson, INDENT_WIDTH, decodeNestedJson, utf8ByteLength, isJsonlMode, expandJsonl, compactJsonl, jsonlRecordErrors, countJsonlRecords } from './jsonFormat'

// -- Types ---------------------------------------------------------------------

interface Tab {
    id: string
    title: string
    filePath: string | null
    dirty: boolean
    // Each tab owns a full EditorState; switching swaps it into the single view.
    state: EditorState
    savedContent: string
}

// -- Icon HTML strings ---------------------------------------------------------

const svgNew = faSvg(faFile)
const svgOpen = faSvg(faFolderOpen)
const svgSave = faSvg(faFloppyDisk)
const svgSaveAs = faSvg(faFileArrowDown)
const svgFormat = faSvg(faBarsStaggered)
const svgMinify = faSvg(faBars)
const svgExpand = faSvg(faPlus)
const svgCollapse = faSvg(faMinus)
const svgSort = faSvg(faArrowDownAZ)
const svgPlus = faSvg(faPlus)
const svgXmark = faSvg(faXmark)

// -- Inject button icons -------------------------------------------------------

function injectButtonIcons(): void {
    const set = (id: string, svg: string) => {
        const el = document.getElementById(id)
        if (el) el.innerHTML = svg
    }
    set('btnNew', svgNew)
    set('btnOpen', svgOpen)
    set('btnSave', svgSave)
    set('btnSaveAs', svgSaveAs)
    set('btnFormat', svgFormat)
    set('btnMinify', svgMinify)
    set('btnExpandAll', svgExpand)
    set('btnCollapseAll', svgCollapse)
    set('btnSort', svgSort)
    set('btnAddTab', svgPlus)
}

// -- State ---------------------------------------------------------------------

const tabs: Tab[] = []
let activeTabId: string | null = null
let untitledCounter = 0
let pendingCloseTabId: string | null = null

// -- Session persistence (standalone window only) -------------------------------

let persistEnabled = false
let persistTimer: ReturnType<typeof setTimeout> | null = null

// A buffer needs a draft when it is untitled (no filePath) with content, or dirty.
function buildSnapshot(): JsonSessionSnapshot {
    return {
        activeBufferId: activeTabId,
        buffers: tabs.map(tab => {
            const text = tabContent(tab)
            const needsDraft = tab.dirty || (tab.filePath === null && text.length > 0)
            return {
                id: tab.id,
                title: tab.title,
                filePath: tab.filePath,
                dirty: tab.dirty,
                content: needsDraft ? text : null,
            }
        }),
    }
}

function cancelPersistTimer(): void {
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null }
}

/** Push immediately for structural changes (save, tab open/close, window close). */
function persistNow(): void {
    if (!persistEnabled) return
    cancelPersistTimer()
    window.rokdock.json.persistSession(buildSnapshot())
}

/** Push debounced (about 1s) for content edits. */
function persistSoon(): void {
    if (!persistEnabled) return
    cancelPersistTimer()
    persistTimer = setTimeout(() => { persistTimer = null; window.rokdock.json.persistSession(buildSnapshot()) }, 1000)
}

// Theme/font config received from get-initial-data, held for live re-theme.
let sessionTokenColors: Record<string, string> | null = null
let sessionFontSize = 13
let sessionFontFamily = 'var(--rokdock-font-mono)'
let sessionBackground = 'var(--rokdock-bg-base)'

// -- Editor setup ------------------------------------------------------------

// The theme lives in a compartment so a live theme switch is a single
// reconfigure dispatch, no re-mount and no CSS re-read hack.
const themeCompartment = new Compartment()

function currentThemeExtension(): Extension {
    return buildJsonEditorTheme(!isLightTheme(), sessionTokenColors, sessionFontSize, sessionFontFamily, sessionBackground)
}

// Fires for every transaction on the active tab. Keeps the tab's stored state in
// sync (so a switch away preserves edits, selection, and folds), tracks dirty,
// and refreshes the placeholder and status bar.
const editorUpdateListener = EditorView.updateListener.of(update => {
    const tab = getActiveTab()
    if (tab) {
        tab.state = update.state
        if (update.docChanged) {
            // Compare length first so a size-changing edit (the common case) is
            // detected without serializing the whole document on every keystroke.
            const doc = update.state.doc
            const nowDirty = doc.length !== tab.savedContent.length || doc.toString() !== tab.savedContent
            if (tab.dirty !== nowDirty) {
                tab.dirty = nowDirty
                setTabDirty(tab)
            }
            updatePlaceholder()
            updateStatusBar()
            persistSoon()
        } else if (update.selectionSet) {
            // Cursor moved without an edit: refresh only the position, skipping the
            // byte-size re-encode (the size cannot have changed).
            updateStatusPosition()
        }
    }
    updateParseStatus()
})

// Lezer JSON node names that represent a value (an array element).
const JSON_VALUE_NODES = new Set(['String', 'Number', 'Object', 'Array', 'True', 'False', 'Null'])

// Counts the direct children of the object/array that a fold range covers, so
// the collapsed placeholder can show "how much is hidden". The fold range starts
// just inside the opening bracket; resolve there and climb to the container node.
function countFoldChildren(state: EditorState, range: { from: number; to: number }): number {
    const tree = syntaxTree(state)
    let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(range.from, 1)
    while (node && node.name !== 'Object' && node.name !== 'Array') node = node.parent
    if (!node) return 0
    let count = 0
    for (let child = node.firstChild; child; child = child.nextSibling) {
        if (node.name === 'Object') {
            if (child.name === 'Property') count++
        } else if (JSON_VALUE_NODES.has(child.name)) {
            count++
        }
    }
    return count
}

// True if any object in the document has the same key more than once. format and
// minify round-trip through JSON.parse, which silently keeps only the last value
// for a duplicate key, so we warn before that data loss happens.
function hasDuplicateKeys(state: EditorState): boolean {
    const tree = syntaxTree(state)
    let found = false
    tree.iterate({
        enter: node => {
            if (found) return false
            if (node.name === 'Object') {
                const keys = new Set<string>()
                for (let child = node.node.firstChild; child; child = child.nextSibling) {
                    if (child.name !== 'Property') continue
                    const nameNode = child.firstChild
                    if (nameNode?.name === 'PropertyName') {
                        const key = state.sliceDoc(nameNode.from, nameNode.to)
                        if (keys.has(key)) {
                            found = true
                            return false
                        }
                        keys.add(key)
                    }
                }
            }
            return undefined
        },
    })
    return found
}

// The JSON parse linter, wrapped so an empty document is not flagged as a parse
// error: a blank buffer shows the placeholder, not a phantom failure. One source
// feeds both the lint extension (the gutter/inline markers and the status bar,
// debounced) and the on-demand jump-to-error / failure-toast paths, which call
// it directly for the current document's position without waiting on the debounce.
const baseJsonLinter = jsonParseLinter()

function lintJsonl(text: string): Diagnostic[] {
    return jsonlRecordErrors(text).map(({ from, to, message }) => {
        return { from, to, severity: 'error' as const, message }
    })
}

// isJsonlMode scans the whole buffer (full-document JSON.parse plus a per-line
// parse), and the lint, format, and status paths each ask the same question on
// the same document. Cache the answer by document identity (CM6 swaps the Text
// object only on edit) plus active file path so a cursor move or a second reader
// in the same cycle reuses the result instead of re-parsing the buffer.
let jsonlModeCache: { doc: Text; filePath: string | null; result: boolean } | null = null

function currentIsJsonlMode(view: EditorView): boolean {
    const doc = view.state.doc
    const filePath = getActiveTab()?.filePath ?? null
    if (jsonlModeCache && jsonlModeCache.doc === doc && jsonlModeCache.filePath === filePath) {
        return jsonlModeCache.result
    }
    const result = isJsonlMode(filePath, doc.toString())
    jsonlModeCache = { doc, filePath, result }
    return result
}

function jsonLinterSource(view: EditorView): readonly Diagnostic[] {
    if (view.state.doc.length === 0) return []
    if (currentIsJsonlMode(view)) return lintJsonl(view.state.doc.toString())
    return baseJsonLinter(view)
}

function baseExtensions(): Extension[] {
    return [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        drawSelection(),
        dropCursor(),
        bracketMatching(),
        indentOnInput(),
        codeFolding({
            // Collapsed ranges show a centered ellipsis plus the child count.
            preparePlaceholder: (state, range) => countFoldChildren(state, range),
            placeholderDOM: (_view, onclick, prepared) => {
                const el = document.createElement('span')
                el.className = 'cm-foldPlaceholder'
                const count = prepared as number
                el.textContent = count > 0 ? `... ${count}` : '...'
                el.title = 'Click to expand'
                el.addEventListener('click', onclick)
                return el
            },
        }),
        foldGutter({ markerDOM: foldMarkerDOM }),
        json(),
        // CM6 lint runs on the main thread, so there is no worker and no
        // worker-src CSP grant. It marks bad JSON in the gutter and inline.
        linter(jsonLinterSource),
        // Raise the lint gutter's precedence so its error markers render in the
        // leftmost column, to the left of the line numbers.
        Prec.high(lintGutter()),
        search({ top: true }),
        EditorState.tabSize.of(INDENT_WIDTH),
        indentUnit.of(' '.repeat(INDENT_WIDTH)),
        scrollPastEnd(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap, ...searchKeymap]),
        themeCompartment.of(currentThemeExtension()),
        editorUpdateListener,
    ]
}

function createState(content: string): EditorState {
    return EditorState.create({ doc: content, extensions: baseExtensions() })
}

const view = new EditorView({
    parent: document.getElementById('editor') as HTMLDivElement,
    state: createState(''),
})

// First parse-error diagnostic from an immediate (non-debounced) lint, or
// undefined when the document parses cleanly (or is empty). Used by the
// on-demand jump-to-error and failure-toast paths, which need the current
// document's error position without waiting on the lint extension's debounce.
function firstParseError(): Diagnostic | undefined {
    return jsonLinterSource(view)[0]
}

// -- Live theme switching ------------------------------------------------------

/**
 * Applies the current theme extension to the active view and to every
 * background tab's stored state. Call this whenever the theme, font, or
 * syntax color session vars change so all tabs stay in sync.
 */
function reconfigureThemeAllTabs(): void {
    const themeExtension = currentThemeExtension()
    view.dispatch({ effects: themeCompartment.reconfigure(themeExtension) })
    // Background tabs hold their own state snapshots, so reconfigure them too;
    // otherwise switching to one would restore the theme that was active when it
    // was last shown. The same extension instance is reused across all tabs.
    for (const tab of tabs) {
        if (tab.id !== activeTabId) {
            tab.state = tab.state.update({ effects: themeCompartment.reconfigure(themeExtension) }).state
        }
    }
}

window.addEventListener('rokdock-theme-changed', () => {
    reconfigureThemeAllTabs()
})

/**
 * Returns a token-color map with every JSON token key set to the given color.
 * Used for the 'none' (no colorization) preset so resolveTokenColors renders
 * plain mono text in the user's chosen fallback color instead of the per-token
 * CSS variable defaults.
 */
function buildMonoTokenColors(color: string): Record<string, string> {
    return {
        objectKey: color,
        objectStringValue: color,
        objectNumberValue: color,
        objectBooleanValue: color,
        objectNullValue: color,
        objectPunctuation: color,
    }
}

/** The code-surface subset of the appearance draft that the editor consumes,
 *  delivered both at boot (get-initial-data) and live (the appearance broadcast). */
type CodeStyle = Pick<AppearanceDraft, 'fontFamily' | 'fontSize' | 'syntaxPreset' | 'syntaxCustom' | 'useThemeBackground' | 'fallbackColor'>

/**
 * Resolves the raw code-style fields into the session font, token colors, and
 * background. The syntax theme and the mono fallback are resolved here (in the
 * renderer) rather than in main, so both the boot path and the live broadcast
 * share one resolution. Does not reconfigure the view; the caller dispatches it.
 */
function applyCodeStyle(style: CodeStyle): void {
    const mode = isLightTheme() ? 'light' : 'dark'
    const theme = resolveSyntaxTheme(style.syntaxPreset as TerminalSyntaxThemePreset, mode, style.syntaxCustom)
    sessionFontFamily = style.fontFamily || 'var(--rokdock-font-mono)'
    sessionFontSize = style.fontSize || 13
    sessionTokenColors = style.syntaxPreset === 'none' ? buildMonoTokenColors(style.fallbackColor) : (theme.colors as unknown as Record<string, string>)
    sessionBackground = style.useThemeBackground ? theme.background : 'var(--rokdock-bg-base)'
}

window.addEventListener('rokdock-appearance-applied', (e) => {
    applyCodeStyle((e as CustomEvent<AppearanceDraft>).detail)
    reconfigureThemeAllTabs()
})

// -- Placeholder ---------------------------------------------------------------

const placeholderEl = document.getElementById('placeholder') as HTMLDivElement

function updatePlaceholder(): void {
    const tab = getActiveTab()
    if (!tab) {
        placeholderEl.classList.remove('hidden')
        return
    }
    if (view.state.doc.length === 0 && !tab.dirty) {
        placeholderEl.classList.remove('hidden')
    } else {
        placeholderEl.classList.add('hidden')
    }
}

// -- Tab Management ------------------------------------------------------------

const tabListEl = document.getElementById('tabList') as HTMLDivElement

function getActiveTab(): Tab | null {
    return tabs.find(tab => tab.id === activeTabId) ?? null
}

// The update listener writes the active tab's state on every dispatch (and it
// fires synchronously), so a tab's stored state is always current, active or not.
function tabContent(tab: Tab): string {
    return tab.state.doc.toString()
}

function createTab(title?: string | null, content?: string | null, filePath?: string | null, id?: string): Tab {
    if (!title) {
        untitledCounter++
        title = `untitled-${untitledCounter}`
    }
    const initialContent = content ?? ''
    const tab: Tab = {
        id: id ?? generateId(),
        title,
        filePath: filePath ?? null,
        dirty: false,
        state: createState(initialContent),
        savedContent: initialContent,
    }
    tabs.push(tab)
    switchToTab(tab.id) // switchToTab renders the tab strip, so no extra renderTabs() here
    persistNow()
    return tab
}

function switchToTab(id: string): void {
    const tab = tabs.find(tab => tab.id === id)
    if (!tab) return
    // The outgoing tab's state is already current (the update listener keeps it
    // synced on every dispatch), so no manual capture is needed before the swap.
    activeTabId = id
    view.setState(tab.state)
    view.focus()
    renderTabs()
    updatePlaceholder()
    updateStatusBar()
}

function closeTab(id: string): void {
    const tab = tabs.find(tab => tab.id === id)
    if (!tab) return
    if (tab.dirty) {
        pendingCloseTabId = id
        showDialog('Unsaved Changes', `Do you want to save changes to "${tab.title}" before closing?`)
        return
    }
    removeTab(id)
}

function removeTab(id: string): void {
    const idx = tabs.findIndex(tab => tab.id === id)
    if (idx < 0) return
    tabs.splice(idx, 1)
    if (activeTabId === id) {
        if (tabs.length > 0) {
            const newIndex = Math.min(idx, tabs.length - 1)
            switchToTab(tabs[newIndex].id)
        } else {
            activeTabId = null
            view.setState(createState(''))
            updatePlaceholder()
            updateStatusBar()
        }
    }
    renderTabs()
    if (tabs.length === 0) updatePlaceholder()
    persistNow()
}

function markTabSaved(id: string, newTitle: string | null, newFilePath: string | null): void {
    const tab = tabs.find(tab => tab.id === id)
    if (!tab) return
    if (newTitle) tab.title = newTitle
    if (newFilePath) tab.filePath = newFilePath
    tab.dirty = false
    tab.savedContent = tabContent(tab)
    renderTabs()
    persistNow()
}

function renderTabs(): void {
    tabListEl.innerHTML = ''
    for (const tab of tabs) {
        const el = document.createElement('div')
        el.dataset.tabId = tab.id
        el.className =
            'rokdock-tab' +
            (tab.id === activeTabId ? ' active' : '') +
            (tab.dirty ? ' dirty' : '')
        el.innerHTML =
            `<span class="rokdock-tab-label">${escapeHtml(tab.title)}</span>` +
            `<span class="rokdock-tab-dirty" title="Unsaved changes" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:currentColor"></span>` +
            `<button class="rokdock-tab-close" title="Close">${svgXmark}</button>`

        el.addEventListener('click', (e: MouseEvent) => {
            if ((e.target as Element).closest('.rokdock-tab-close')) return
            switchToTab(tab.id)
        })

        const closeBtn = el.querySelector('.rokdock-tab-close') as HTMLButtonElement
        closeBtn.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation()
            closeTab(tab.id)
        })

        el.addEventListener('auxclick', (e: MouseEvent) => {
            if (e.button === 1) {
                e.preventDefault()
                closeTab(tab.id)
            }
        })

        tabListEl.appendChild(el)

        if (tab.id === activeTabId) {
            requestAnimationFrame(() => {
                el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
            })
        }
    }
}

// Toggles just the dirty marker on one tab's existing element. Used on the
// per-keystroke dirty flip so typing does not tear down and rebuild the whole
// tab strip (with its event listeners) on every transition.
function setTabDirty(tab: Tab): void {
    const el = tabListEl.querySelector(`[data-tab-id="${tab.id}"]`)
    el?.classList.toggle('dirty', tab.dirty)
}

function restoreSession(session: JsonRestoredSession): void {
    for (const buffer of session.buffers) {
        const tab = createTab(buffer.title, buffer.content, buffer.filePath, buffer.id)
        if (buffer.dirty) {
            // Force the dirty marker for a restored unsaved buffer. The null-char
            // sentinel can never equal real document text, so the derived dirty
            // check (doc !== savedContent) stays true until the user saves.
            tab.savedContent = '\x00'
            tab.dirty = true
            setTabDirty(tab)
        }
    }
    for (const missingPath of session.missing) {
        showToast(`Couldn't reopen ${missingPath.split(/[\\/]/).pop()}`)
    }
    if (session.activeBufferId && tabs.some(tab => tab.id === session.activeBufferId)) {
        switchToTab(session.activeBufferId)
    }
}

// -- Dialog --------------------------------------------------------------------

const dialogOverlay = document.getElementById('dialogOverlay') as HTMLDivElement
const dialogTitleEl = document.getElementById('dialogTitle') as HTMLHeadingElement
const dialogMessageEl = document.getElementById('dialogMessage') as HTMLParagraphElement

function showDialog(title: string, message: string): void {
    dialogTitleEl.textContent = title
    dialogMessageEl.textContent = message
    dialogOverlay.classList.add('visible')
}

function hideDialog(): void {
    dialogOverlay.classList.remove('visible')
    pendingCloseTabId = null
}

document.getElementById('dialogCancel')!.addEventListener('click', hideDialog)

document.getElementById('dialogDiscard')!.addEventListener('click', () => {
    const id = pendingCloseTabId
    hideDialog()
    if (id) removeTab(id)
})

document.getElementById('dialogSave')!.addEventListener('click', async () => {
    const id = pendingCloseTabId
    const tab = tabs.find(tab => tab.id === id)
    hideDialog()
    if (!tab) return
    const saved = await doSave(tab)
    if (saved && id) removeTab(id)
})

// -- File I/O (via IPC bridge) -------------------------------------------------

async function doSave(tab: Tab): Promise<boolean> {
    const content = tabContent(tab)
    if (tab.filePath) {
        const result = await window.rokdock.json.save(content, tab.filePath)
        if (result?.ok) {
            markTabSaved(tab.id, null, tab.filePath)
            return true
        }
        showToast(result?.error ?? 'Save failed')
        return false
    }
    return doSaveAs(tab)
}

async function doSaveAs(tab: Tab): Promise<boolean> {
    const content = tabContent(tab)
    const result = await window.rokdock.json.saveAs(content)
    if (result?.ok && result.filePath) {
        const name = result.filePath.split(/[\\/]/).pop() ?? tab.title
        markTabSaved(tab.id, name, result.filePath)
        return true
    }
    if (result && !result.ok && result.error && result.error !== 'Save canceled.') {
        showToast(result.error)
    }
    return false
}

async function doOpenFile(): Promise<void> {
    const result = await window.rokdock.json.openFile()
    if (!result?.ok) return
    const name = (result.filePath ?? '').split(/[\\/]/).pop() ?? 'file.json'
    createTab(name, result.content ?? '', result.filePath ?? null)
}

// -- Toolbar Actions -----------------------------------------------------------

document.getElementById('btnNew')!.addEventListener('click', () => { createTab() })
document.getElementById('btnAddTab')!.addEventListener('click', () => { createTab() })
document.getElementById('btnOpen')!.addEventListener('click', () => { void doOpenFile() })
document.getElementById('btnSave')!.addEventListener('click', () => {
    const tab = getActiveTab()
    if (tab) void doSave(tab)
})
document.getElementById('btnSaveAs')!.addEventListener('click', () => {
    const tab = getActiveTab()
    if (tab) void doSaveAs(tab)
})
document.getElementById('btnFormat')!.addEventListener('click', doFormat)
document.getElementById('btnMinify')!.addEventListener('click', doMinify)
document.getElementById('btnExpandAll')!.addEventListener('click', doUnfoldAll)
document.getElementById('btnCollapseAll')!.addEventListener('click', doFoldAll)
document.getElementById('btnSort')!.addEventListener('click', doSortAtCursor)

// Horizontal scroll of tab list with mouse wheel
tabListEl.addEventListener(
    'wheel',
    (e: WheelEvent) => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            tabListEl.scrollLeft += e.deltaY
            e.preventDefault()
        }
    },
    { passive: false }
)

// -- Editor Operations ---------------------------------------------------------

// Replaces the whole document and moves the cursor to the top. Used by both
// format and minify after they validate and rewrite the JSON.
function replaceDocument(text: string): void {
    view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: 0 },
    })
}

const DUPLICATE_KEY_WARNING = 'Duplicate keys were merged (last value kept)'

// Shared body for Format and Minify: validate the active document, rewrite it
// with the given transform, and warn if the parse round-trip dropped duplicate
// keys. `action` is the verb used in the failure toast ("format" / "minify").
function transformDocument(transform: (text: string) => string, action: string): void {
    const tab = getActiveTab()
    if (!tab) return
    const text = view.state.doc.toString().trim()
    if (!text) return
    const jsonl = currentIsJsonlMode(view)
    try {
        // In JSONL mode Format expands each record across lines and Minify collapses
        // back to one compact record per line; the round trip is reversible.
        const jsonlTransform = action === 'minify' ? compactJsonl : expandJsonl
        const result = jsonl ? jsonlTransform(text) : transform(text)
        // Duplicate-key merging only applies to single-document JSON. JSONL records
        // are linted per-record, so the duplicate check is irrelevant there.
        const droppedDuplicates = !jsonl && hasDuplicateKeys(view.state)
        if (result !== text) replaceDocument(result)
        if (droppedDuplicates) showToast(DUPLICATE_KEY_WARNING)
    } catch {
        const error = firstParseError()
        const where = error ? ` at ${formatLineColumn(error.from)}` : ''
        showToast(`Invalid JSON${where} - cannot ${action}`)
    }
}

function doFormat(): void { transformDocument(formatJson, 'format') }
function doMinify(): void { transformDocument(minifyJson, 'minify') }

function doFoldAll(): void {
    foldAll(view)
}

function doUnfoldAll(): void {
    unfoldAll(view)
}

function doSortAtCursor(): void {
    const tab = getActiveTab()
    if (!tab) return
    const text = view.state.doc.toString()
    // CM6 selection offsets are document indices directly, no row/col conversion.
    const cursorIndex = view.state.selection.main.head

    const span = findEnclosingSpan(text, cursorIndex)
    if (!span) {
        showToast('No object or array at cursor')
        return
    }

    const slice = text.substring(span.start, span.end + 1)
    const sorted = sortJsonValue(slice)
    if (!sorted) {
        showToast('Not a sortable value')
        return
    }

    // Indent the replacement to the column where the opening bracket sits.
    const startLine = view.state.doc.lineAt(span.start)
    const baseIndent = ' '.repeat(span.start - startLine.from)
    const replacement = reindentJson(sorted, baseIndent)

    view.dispatch({ changes: { from: span.start, to: span.end + 1, insert: replacement } })
    showToast('Sorted')
}

function doJumpToError(): void {
    const error = firstParseError()
    if (!error) {
        showToast('No JSON errors')
        return
    }
    view.dispatch({ selection: { anchor: error.from }, scrollIntoView: true })
    view.focus()
}

function doUnescapeNested(): void {
    const sel = view.state.selection.main
    let raw: string | null = null
    let label = 'unescaped'

    if (!sel.empty) {
        raw = view.state.sliceDoc(sel.from, sel.to)
    } else {
        const node = syntaxTree(view.state).resolveInner(sel.head, 0)
        if (node.name === 'String') {
            raw = view.state.sliceDoc(node.from, node.to)
            const parent = node.parent
            if (parent?.name === 'Property') {
                const nameNode = parent.firstChild
                if (nameNode?.name === 'PropertyName') {
                    // Strip the key's surrounding quotes for the tab title.
                    const key = view.state.sliceDoc(nameNode.from + 1, nameNode.to - 1)
                    if (key) label = `${key} (unescaped)`
                }
            }
        }
    }

    if (!raw) {
        showToast('No nested JSON at cursor')
        return
    }
    const decoded = decodeNestedJson(raw)
    if (!decoded) {
        showToast('No nested JSON at cursor')
        return
    }
    createTab(label, decoded)
}

// -- Status Bar ----------------------------------------------------------------

const statusPosEl = document.getElementById('statusPos') as HTMLSpanElement
const statusSizeEl = document.getElementById('statusSize') as HTMLSpanElement
const statusParseEl = document.getElementById('statusParse') as HTMLSpanElement
statusParseEl.addEventListener('click', () => {
    if (statusParseEl.classList.contains('has-error')) doJumpToError()
})
let lastParseStatus = ''

// Formats a document offset as a 1-based "Ln X, Col Y" label.
function formatLineColumn(offset: number): string {
    const line = view.state.doc.lineAt(offset)
    return `Ln ${line.number}, Col ${offset - line.from + 1}`
}

// Line/column from the cursor. Cheap, so it runs on every cursor move.
function updateStatusPosition(): void {
    statusPosEl.textContent = formatLineColumn(view.state.selection.main.head)
}

// Byte size of the document. Scans the whole doc, so it runs only when the
// document actually changes, not on cursor movement.
function updateStatusSize(): void {
    const bytes = utf8ByteLength(view.state.doc.toString())
    statusSizeEl.textContent = formatBytes(bytes)
}

function updateStatusBar(): void {
    updateStatusPosition()
    updateStatusSize()
}

// Reflects the JSON parse state in the status bar. Reads the diagnostics the
// lint extension already computed (no extra parse), so it is cheap to call on
// every update; it must run on every update (not just docChanged) because the
// debounced lint result lands in its own later transaction. The DOM is written
// only when the text actually changes.
function updateParseStatus(): void {
    let first: Diagnostic | undefined
    forEachDiagnostic(view.state, diagnostic => { if (!first) first = diagnostic })
    let statusText: string
    if (first) {
        statusText = `Error ${formatLineColumn(first.from)}`
    } else {
        statusText = currentIsJsonlMode(view)
            ? `JSONL: ${countJsonlRecords(view.state.doc.toString())} records`
            : 'JSON'
    }
    if (statusText !== lastParseStatus) {
        lastParseStatus = statusText
        statusParseEl.textContent = statusText
        statusParseEl.classList.toggle('has-error', first !== undefined)
    }
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// -- Toast ---------------------------------------------------------------------

const showToast = createToast(document.getElementById('toast') as HTMLDivElement)

// -- Command channel (driven by the main process via the typed IPC channel) -----

const commandHandlers = {
    newTab: () => { createTab() },
    openFile: () => { void doOpenFile() },
    save: () => { const tab = getActiveTab(); if (tab) void doSave(tab) },
    saveAs: () => { const tab = getActiveTab(); if (tab) void doSaveAs(tab) },
    closeTab: () => { const tab = getActiveTab(); if (tab) closeTab(tab.id) },
    undo: () => undo(view),
    redo: () => redo(view),
    find: () => openSearchPanel(view),
    selectAll: () => selectAll(view),
    jumpToError: doJumpToError,
    format: doFormat,
    minify: doMinify,
    foldAll: doFoldAll,
    unfoldAll: doUnfoldAll,
    sortAtCursor: doSortAtCursor,
    unescapeNested: doUnescapeNested,
} satisfies Record<Exclude<JsonEditorCommand, { type: 'addTab' } | { type: 'toast' }>['type'], () => void>

window.rokdock.toolWindow.onCommand((raw: unknown) => {
    const command = raw as JsonEditorCommand
    if (command.type === 'addTab') {
        createTab(command.title ?? null, command.content)
        return
    }
    if (command.type === 'toast') {
        showToast(command.message)
        return
    }
    commandHandlers[command.type]()
})

// -- Init ----------------------------------------------------------------------

injectButtonIcons()

// Show the platform-correct modifier key in the placeholder hint (Cmd on macOS).
const modifierKey = navigator.userAgent.toLowerCase().includes('mac') ? 'Cmd' : 'Ctrl'
const placeholderHintEl = document.querySelector('.placeholder-hint')
if (placeholderHintEl) placeholderHintEl.textContent = `${modifierKey}+O to open | ${modifierKey}+V to paste`

async function init(): Promise<void> {
    // Wait until the theme class is applied so applyCodeStyle resolves the syntax
    // theme for the correct light/dark mode on first paint.
    await themeReady
    const data = await window.rokdock.json.getInitialData()

    // Resolve the persisted code-surface appearance (font, syntax, background,
    // mono fallback) into the session vars, the same way the live broadcast does.
    applyCodeStyle({
        fontFamily: data.fontFamily,
        fontSize: data.fontSize,
        syntaxPreset: data.syntaxPreset,
        syntaxCustom: data.syntaxCustom,
        useThemeBackground: data.useThemeBackground,
        fallbackColor: data.fallbackColor,
    })

    // Reconfigure the existing (empty) view with the resolved font and colors
    // before the first tab is created.
    view.dispatch({ effects: themeCompartment.reconfigure(currentThemeExtension()) })

    if (data.persist && data.session) {
        restoreSession(data.session)
    }
    if (data.initialContent) {
        // Dedupe by full path: focus an already-restored tab for the same file (two
        // files can share a basename, so matching on title alone would open the wrong
        // tab). Without a path, always add the launched content as a new tab.
        const existing = data.initialFilePath
            ? tabs.find(tab => tab.filePath === data.initialFilePath)
            : null
        if (existing) {
            switchToTab(existing.id)
        } else {
            createTab(data.initialTitle ?? null, data.initialContent)
        }
    } else if (tabs.length === 0) {
        createTab()
    }
    if (data.initialError) {
        showToast(data.initialError)
    }
    // Enable persistence only after the boot tabs are built, so the per-tab
    // persistNow calls during restore are suppressed. The push below writes one
    // consolidated initial snapshot.
    persistEnabled = data.persist
    if (persistEnabled) persistNow()
    window.addEventListener('beforeunload', () => persistNow())
}

void init()
