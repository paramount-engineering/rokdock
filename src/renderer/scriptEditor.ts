import remoteImageUrl from '../../resources/remote.png'
import { bootBundledTheme } from '@shared/entryBootstrap'
import './appearanceModalTrigger'
import './scriptEditor.css'
void bootBundledTheme()

import { faPlay, faStop, faFloppyDisk, faUpload, faDownload, faPlus, faXmark, faCheck, faCircle, faTriangleExclamation, faRotateRight, faChevronDown, faObjectUngroup, faPaste, faCopy, faArrowDownAZ, faSortNumericDown, faTrash, faPen } from '@fortawesome/free-solid-svg-icons'
import { faSvg } from '@shared/icons'
import type { ScriptFile, Step, LoopStep, BlockDefinitionStep, LaunchStep, RaspMetadata, StepAnnotation, EngineEvent } from '@shared/script'
import { chipKey, chipLabel, getStepTypeAttribute, stepLabel, escapeHtml, resolveLaunchChannel, stepSummaryHtml, looksLikeRasp, migrateSteps, comparePathsDescending, comparePathsAscending, blankScript, getBlockNames } from './scriptEditorLogic'
import { createToast } from '@shared/toast'
import type { CommonToolWindowCommand } from '@shared/toolWindowCommands'

declare const window: Window & {
    rokdock: {
        scriptEditor: {
            getInitialData(): Promise<unknown>
            list(): Promise<{ ok: boolean; scripts?: { name: string; filePath: string; modifiedAt: number; stepCount: number }[] }>
            load(filePath: string): Promise<{ ok: boolean; script?: ScriptFile }>
            save(script: ScriptFile): Promise<{ ok: boolean; filePath?: string }>
            delete(filePath: string): Promise<{ ok: boolean }>
            saveSortOrder(order: string[]): Promise<{ ok: boolean }>
            importRasp(): Promise<{ ok: boolean; script?: ScriptFile; warnings?: string[] }>
            importRaspText(yaml: string, name?: string): Promise<{ ok: boolean; script?: ScriptFile; warnings?: string[] }>
            exportRasp(script: ScriptFile): Promise<{ ok: boolean; warnings?: string[] }>
            copyRasp(script: ScriptFile): Promise<{ ok: boolean; yaml?: string; warnings?: string[] }>
            extractTokens(steps: Step[]): string[]
            queryApps(deviceIp: string): Promise<{ ok: boolean; apps?: { id: string; name: string }[]; error?: string }>
            queryAppIcon(deviceIp: string, appId: string): Promise<{ ok: boolean; dataUri?: string }>
            play(script: ScriptFile, deviceIp: string): Promise<{ ok: boolean; error?: string }>
            stopPlayback(): Promise<{ ok: boolean }>
            onEngineEvent(callback: (ev: EngineEvent) => void): () => void
            onLoadSteps(callback: (steps: Step[], name: string, filePath: string | null) => void): () => void
            onScriptsChanged(callback: () => void): () => void
        }
        discovery: {
            getDevices(): Promise<{ ip: string; name: string }[]>
        }
        toolWindow: {
            onCommand(handler: (command: unknown) => void): () => void
        }
    }
}

interface InitialData {
    script: ScriptFile
    initialFilePath: string | null
    initialDeviceIp: string
    startRecording: boolean
    initialError: string | null
    initialWarnings: string[]
}

// --- Icon HTML strings ---

const iconPlay = faSvg(faPlay)
const iconStop = faSvg(faStop)
const iconSave = faSvg(faFloppyDisk)
const iconImport = faSvg(faUpload)
const iconExport = faSvg(faDownload)
const iconPlus = faSvg(faPlus)
const iconX = faSvg(faXmark)
const iconCheck = faSvg(faCheck)
const iconFail = faSvg(faXmark)
const iconSpin = faSvg(faCircle)
const iconRecord = faSvg(faCircle)
const iconRefresh = faSvg(faRotateRight)
const iconChevron = faSvg(faChevronDown)
const iconUngroup = faSvg(faObjectUngroup)
const iconWarn = faSvg(faTriangleExclamation)
const iconPaste = faSvg(faPaste)
const iconCopy = faSvg(faCopy)
const iconSortAZ = faSvg(faArrowDownAZ)
const iconSortNum = faSvg(faSortNumericDown)
const iconTrash = faSvg(faTrash)
const iconEdit = faSvg(faPen)
const iconAddBefore = '<svg viewBox="0 0 14 14" fill="currentColor"><rect x="6.25" y="0.5" width="1.5" height="6" rx="0.75"/><rect x="3.5" y="2.75" width="7" height="1.5" rx="0.75"/><rect x="0.5" y="9.5" width="13" height="4" rx="1.5"/></svg>'
const iconAddAfter = '<svg viewBox="0 0 14 14" fill="currentColor"><rect x="0.5" y="0.5" width="13" height="4" rx="1.5"/><rect x="6.25" y="7.5" width="1.5" height="6" rx="0.75"/><rect x="3.5" y="9.75" width="7" height="1.5" rx="0.75"/></svg>'

// --- Icon injection ---

function injectButtonIcons(): void {
    const set = (id: string, html: string) => {
        const element = document.getElementById(id)
        if (element) element.innerHTML = html
    }
    set('new-btn', iconPlus)
    set('save-btn', iconSave)
    set('import-btn', iconImport)
    set('export-btn', iconExport)
    set('paste-rasp-btn', iconPaste)
    set('copy-rasp-btn', iconCopy)
    set('record-btn', iconRecord)
    set('play-btn', iconPlay)
    set('stop-btn', iconStop)
    set('stop-record-btn', iconStop)
    set('add-step-btn', iconPlus + ' Add step')
    set('var-add-btn', iconPlus)
    set('lib-new-hdr-btn', iconPlus)
    set('refresh-lib-btn', iconRefresh)
    set('clear-log-btn', iconX)
    const renameIcon = document.getElementById('tb-rename-icon')
    if (renameIcon) renameIcon.innerHTML = iconEdit
    const logChevron = document.getElementById('log-chevron-icon')
    if (logChevron) logChevron.innerHTML = iconChevron
    const statusBarWarnIcon = document.getElementById('sb-warn-icon')
    if (statusBarWarnIcon) statusBarWarnIcon.innerHTML = iconWarn
}

// --- State ---

const showToast = createToast(document.getElementById('toast') as HTMLDivElement)

// Main surfaces transient messages (e.g. a CLI file-open failure on an
// already-open window) over the shared tool-window command channel. Registered
// at module scope, like the other tool renderers, so a toast pushed during boot
// is not dropped while init() is still awaiting its initial data.
window.rokdock.toolWindow.onCommand((raw: unknown) => {
    const command = raw as CommonToolWindowCommand
    if (command.type === 'toast') showToast(command.message)
})
let script: ScriptFile = blankScript()
let savedFilePath: string | null = null
let isDirty = false
let isPlaying = false
let isRecording = false
let recordStart = 0
let lastKeyTime = 0
let selectedDeviceIp = ''
let recTimerInterval: ReturnType<typeof setInterval> | null = null
let recElapsedSecs = 0
let recStepCount = 0
const DELAY_MIN_MS = 500
const DELAY_MAX_MS = 10000
const DELAY_ROUND_MS = 100
const HOLD_THRESHOLD_MS = 300
let pendingHold: { key: string; startTime: number } | null = null
let suppressNextKeypress = false
let recordDelays = false
let dragSourcePath: number[] | null = null
/** The single step row currently showing the drop indicator, so dragover need not scan the DOM. */
let dragOverElement: HTMLElement | null = null
const selectedSet = new Set<string>()
let lastClickedPath: number[] | null = null
const collapsedSet = new Set<string>()
let libraryScripts: { name: string; filePath: string; modifiedAt: number; stepCount: number }[] = []

function markDirty(): void { isDirty = true }
function clearDirty(): void { isDirty = false }

// --- ContextMenu ---

interface ContextMenuItem {
    label?: string
    action?: () => void
    danger?: boolean
    dim?: boolean
    isSep?: boolean
}

class ContextMenu {
    menuElement: HTMLDivElement

    constructor() {
        this.menuElement = document.createElement('div')
        this.menuElement.className = 'ctx-menu'
        this.menuElement.style.display = 'none'
        document.body.appendChild(this.menuElement)

        document.addEventListener('mousedown', (e: MouseEvent) => {
            if (!this.menuElement.contains(e.target as Node)) this.close()
        })
        document.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Escape') this.close()
        })
    }

    show(x: number, y: number, items: (ContextMenuItem | null)[]): void {
        this.menuElement.innerHTML = ''
        for (const item of items) {
            if (!item) continue
            if (item.isSep) {
                const sep = document.createElement('div')
                sep.className = 'ctx-sep'
                this.menuElement.appendChild(sep)
                continue
            }
            const itemElement = document.createElement('div')
            itemElement.className = 'ctx-item' + (item.danger ? ' danger' : '') + (item.dim ? ' dim' : '')
            itemElement.textContent = item.label ?? ''
            if (item.action && !item.dim) {
                itemElement.addEventListener('click', () => { this.close(); item.action!() })
            }
            this.menuElement.appendChild(itemElement)
        }
        this.menuElement.style.display = ''
        const menuWidth = 190
        const menuHeight = this.menuElement.scrollHeight
        const left = (x + menuWidth > window.innerWidth - 8) ? x - menuWidth : x
        const top = (y + menuHeight > window.innerHeight - 8) ? y - menuHeight : y
        this.menuElement.style.left = Math.max(4, left) + 'px'
        this.menuElement.style.top = Math.max(4, top) + 'px'
    }

    close(): void {
        this.menuElement.style.display = 'none'
        this.menuElement.innerHTML = ''
    }
}

const contextMenu = new ContextMenu()

// --- StepEditorPopup ---

interface CommitResult {
    commitFn: (() => Step) | null
}

class StepEditorPopup {
    private _rootElement: HTMLDivElement
    private _header: HTMLDivElement
    private _chipElement: HTMLSpanElement
    private _stepNumberElement: HTMLSpanElement
    private _body: HTMLDivElement
    private _footer: HTMLDivElement
    private _cancelButton: HTMLButtonElement
    private _doneButton: HTMLButtonElement
    private _step: Step | null = null
    private _indexPath: (number | string)[] | null = null
    private _commitFn: (() => Step) | null = null
    private _isNew = false

    constructor() {
        this._rootElement = document.createElement('div')
        this._rootElement.className = 'sep'
        this._rootElement.style.display = 'none'

        this._header = document.createElement('div')
        this._header.className = 'sep-hdr'

        this._chipElement = document.createElement('span')
        this._chipElement.className = 'chip'

        this._stepNumberElement = document.createElement('span')
        this._stepNumberElement.className = 'sep-stepnum'

        this._header.appendChild(this._chipElement)
        this._header.appendChild(this._stepNumberElement)

        this._body = document.createElement('div')
        this._body.className = 'sep-body'

        this._footer = document.createElement('div')
        this._footer.className = 'sep-foot'

        this._cancelButton = document.createElement('button')
        this._cancelButton.className = 'sep-btn sep-btn-cancel'
        this._cancelButton.textContent = 'Cancel'

        this._doneButton = document.createElement('button')
        this._doneButton.className = 'sep-btn sep-btn-done'
        this._doneButton.textContent = 'Done'

        this._footer.appendChild(this._cancelButton)
        this._footer.appendChild(this._doneButton)

        this._rootElement.appendChild(this._header)
        this._rootElement.appendChild(this._body)
        this._rootElement.appendChild(this._footer)

        document.body.appendChild(this._rootElement)

        this._cancelButton.addEventListener('click', () => this.close())
        this._doneButton.addEventListener('click', () => this._commit())

        document.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Escape' && this._step) this.close()
        })
        document.addEventListener('mousedown', (e: MouseEvent) => {
            if (this._step && !this._rootElement.contains(e.target as Node)) this.close()
        })
    }

    open(step: Step, anchorEl: HTMLElement, indexPath: (number | string)[], event?: MouseEvent | null, isNew?: boolean): void {
        this._step = step
        this._indexPath = indexPath
        this._isNew = !!isNew

        const chipClass = chipKey(step.type)
        this._chipElement.className = 'chip ' + chipClass
        this._chipElement.textContent = chipLabel(step.type)

        this._stepNumberElement.textContent = 'Step ' + indexPath.filter(segment => typeof segment === 'number').map(segment => (segment as number) + 1).join('.')

        this._body.innerHTML = ''
        const result = this._buildBody(step, this._body)
        this._commitFn = result.commitFn

        const readOnly = step.type === 'waitActiveApp' || step.type === 'assertQuery' || step.type === 'unknown'
        this._doneButton.style.display = readOnly ? 'none' : ''
        this._cancelButton.textContent = readOnly ? 'Close' : 'Cancel'

        this._position(event ?? anchorEl)
        this._rootElement.style.display = 'flex'

        const firstInput = this._body.querySelector('input, textarea, rokdock-number-input, rokdock-select') as HTMLElement | null
        if (firstInput) setTimeout(() => firstInput.focus(), 0)
    }

    close(): void {
        const wasNew = this._isNew
        const path = this._indexPath
        this._step = null
        this._indexPath = null
        this._commitFn = null
        this._isNew = false
        this._rootElement.style.display = 'none'
        if (wasNew && path) deleteStep(path)
    }

    private _commit(): void {
        if (!this._commitFn || !this._indexPath) return
        const newStep = this._commitFn()
        if (newStep) setNestedStep(this._indexPath, newStep)
        this._isNew = false
        this.close()
    }

    private _position(anchor: MouseEvent | HTMLElement): void {
        const popupWidth = 300
        const popupHeight = 400
        let anchorX: number
        let anchorY: number

        if ('clientX' in anchor) {
            anchorX = anchor.clientX
            anchorY = anchor.clientY
        } else {
            const rect = anchor.getBoundingClientRect()
            anchorX = rect.right
            anchorY = rect.top
        }

        let left = anchorX + 6
        if (left + popupWidth > window.innerWidth - 8) {
            left = anchorX - popupWidth - 6
        }
        left = Math.max(8, left)

        let top = anchorY
        if (top + popupHeight > window.innerHeight - 8) {
            top = Math.max(8, window.innerHeight - popupHeight - 8)
        }

        this._rootElement.style.left = left + 'px'
        this._rootElement.style.top = top + 'px'
    }

    private _buildBody(step: Step, container: HTMLDivElement): CommitResult {
        switch (step.type) {
            case 'press':
            case 'key_down':
            case 'key_up': return this._buildPress(step, container)
            case 'text': return this._buildText(step, container)
            case 'delay': return this._buildDelay(step, container)
            case 'screenshot': return this._buildScreenshot(step, container)
            case 'launch': return this._buildLaunch(step, container)
            case 'loop': return this._buildLoop(step, container)
            case 'waitPlayerState': return this._buildWaitPlayerState(step, container)
            case 'validateStreaming': return this._buildValidateStreaming(step, container)
            case 'channelTileOrder': return this._buildChannelTileOrder(step, container)
            case 'comment': return this._buildComment(step, container)
            default: return this._buildReadOnly(step, container)
        }
    }

    private _buildPress(step: Step, container: HTMLDivElement): CommitResult {
        let selectedKey = (step as { key?: string }).key ?? 'Home'

        const badgeRow = document.createElement('div')
        badgeRow.className = 'sep-row'
        const label = document.createElement('span')
        label.className = 'sep-lbl'
        label.textContent = 'Key'
        const badge = document.createElement('span')
        badge.style.cssText = 'font-size:var(--rokdock-font-sm);font-weight:700;color:var(--rokdock-brand-primary-light);font-family:var(--rokdock-font-mono);padding:2px 8px;background:var(--rokdock-brand-primary-faded);border-radius:4px;'
        badge.textContent = selectedKey
        badgeRow.appendChild(label)
        badgeRow.appendChild(badge)
        container.appendChild(badgeRow)

        const hint = document.createElement('span')
        hint.className = 'sep-hint'
        hint.textContent = 'Click the remote to change key'
        container.appendChild(hint)

        const remoteWrap = document.createElement('div')
        remoteWrap.style.cssText = 'margin:4px auto 0;display:flex;justify-content:center;'
        const remoteElement = document.createElement('rokdock-remote')
        remoteElement.style.cssText = 'width:154px;zoom:' + (80 / 154).toFixed(4) + ';'
        const remoteImg = document.createElement('img')
        remoteImg.slot = 'image'
        remoteImg.src = remoteImageUrl
        remoteImg.alt = 'Roku Remote'
        remoteImg.draggable = false
        remoteElement.appendChild(remoteImg)
        remoteWrap.appendChild(remoteElement)
        container.appendChild(remoteWrap)

        remoteElement.addEventListener('remote-keypress', (e: Event) => {
            selectedKey = (e as CustomEvent<{ key: string }>).detail.key
            badge.textContent = selectedKey
        })

        return {
            commitFn: () => ({ ...step, key: selectedKey } as Step)
        }
    }

    private _buildText(step: Step, container: HTMLDivElement): CommitResult {
        const row = document.createElement('div')
        row.className = 'sep-row'
        const label = document.createElement('span')
        label.className = 'sep-lbl'
        label.textContent = 'Value'
        const input = document.createElement('input')
        input.className = 'ed-inp'
        input.type = 'text'
        input.value = (step as { value?: string }).value ?? ''
        input.style.cssText = 'flex:1;min-width:0;font-family:var(--rokdock-font-ui);'
        row.appendChild(label)
        row.appendChild(input)
        container.appendChild(row)

        const vars = Object.keys(script.metadata?.variables ?? {})
        if (vars.length > 0) {
            const chipsRow = document.createElement('div')
            chipsRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:2px;'
            for (const varName of vars) {
                const chip = document.createElement('button')
                chip.style.cssText = 'height:16px;padding:0 6px;border-radius:3px;border:1px solid var(--rokdock-border);background:var(--rokdock-brand-primary-faded);color:var(--rokdock-brand-primary-light);font-size:var(--rokdock-font-sm);font-family:var(--rokdock-font-mono);cursor:pointer;'
                chip.textContent = '${' + varName + '}'
                chip.addEventListener('click', () => {
                    const start = input.selectionStart ?? input.value.length
                    const end = input.selectionEnd ?? input.value.length
                    const insert = '${' + varName + '}'
                    input.value = input.value.slice(0, start) + insert + input.value.slice(end)
                    input.focus()
                    input.setSelectionRange(start + insert.length, start + insert.length)
                })
                chipsRow.appendChild(chip)
            }
            container.appendChild(chipsRow)
        }

        return { commitFn: () => ({ ...step, value: input.value } as Step) }
    }

    private _buildDelay(step: Step, container: HTMLDivElement): CommitResult {
        const row = document.createElement('div')
        row.className = 'sep-row'
        const label = document.createElement('span')
        label.className = 'sep-lbl'
        label.textContent = 'Duration'
        const numberInput = document.createElement('rokdock-number-input')
        numberInput.setAttribute('min', '0.01')
        numberInput.setAttribute('step', '0.01')
        numberInput.setAttribute('value', String((((step as { durationMs?: number }).durationMs ?? 1000) / 1000).toFixed(2)))
        const hint = document.createElement('span')
        hint.className = 'sep-hint'
        hint.textContent = 'seconds'
        row.appendChild(label)
        row.appendChild(numberInput)
        row.appendChild(hint)
        container.appendChild(row)

        return {
            commitFn: () => {
                const secs = Math.max(0.01, (numberInput as unknown as { value: number }).value || 0.01)
                return { ...step, durationMs: Math.round(secs * 1000) } as Step
            }
        }
    }

    private _buildScreenshot(step: Step, container: HTMLDivElement): CommitResult {
        const row = document.createElement('div')
        row.className = 'sep-row'
        const label = document.createElement('span')
        label.className = 'sep-lbl'
        label.textContent = 'Marker'
        const input = document.createElement('input')
        input.className = 'ed-inp'
        input.type = 'text'
        input.value = (step as { marker?: string }).marker ?? ''
        input.placeholder = 'Marker name'
        input.style.cssText = 'flex:1;min-width:0;font-family:var(--rokdock-font-ui);'
        row.appendChild(label)
        row.appendChild(input)
        container.appendChild(row)

        return { commitFn: () => ({ ...step, marker: input.value } as Step) }
    }

    private _buildLaunch(step: Step, container: HTMLDivElement): CommitResult {
        const channel = resolveLaunchChannel(step as LaunchStep, script.metadata)

        const row1 = document.createElement('div')
        row1.className = 'sep-row'
        const lbl1 = document.createElement('span')
        lbl1.className = 'sep-lbl'
        lbl1.textContent = 'Channel'
        const nameInput = document.createElement('input')
        nameInput.className = 'ed-inp'
        nameInput.type = 'text'
        nameInput.value = channel.name
        nameInput.placeholder = 'Channel name'
        nameInput.style.cssText = 'flex:1;min-width:0;font-family:var(--rokdock-font-ui);'
        row1.appendChild(lbl1)
        row1.appendChild(nameInput)
        container.appendChild(row1)

        const row2 = document.createElement('div')
        row2.className = 'sep-row'
        const lbl2 = document.createElement('span')
        lbl2.className = 'sep-lbl'
        lbl2.textContent = 'Channel ID'
        const idInput = document.createElement('input')
        idInput.className = 'ed-inp'
        idInput.type = 'text'
        idInput.value = channel.id
        idInput.placeholder = 'ID'
        idInput.style.cssText = 'flex:1;min-width:0;font-family:var(--rokdock-font-mono);font-size:var(--rokdock-font-sm);'
        const pickButton = document.createElement('button')
        pickButton.className = 'ed-btn'
        pickButton.textContent = 'Pick...'
        pickButton.addEventListener('click', () => {
            if (!selectedDeviceIp) {
                const selectElement = document.getElementById('remote-device-select') as HTMLSelectElement
                selectElement.focus()
                if ((selectElement as { showPicker?: () => void }).showPicker) (selectElement as { showPicker: () => void }).showPicker()
                return
            }
            void showChannelPicker(selectedDeviceIp).then(picked => {
                if (picked) {
                    nameInput.value = picked.name
                    idInput.value = picked.id
                }
            })
        })
        row2.appendChild(lbl2)
        row2.appendChild(idInput)
        row2.appendChild(pickButton)
        container.appendChild(row2)

        return {
            commitFn: () => ({
                ...step,
                channelName: nameInput.value || undefined,
                channelId: idInput.value || undefined
            } as Step)
        }
    }

    private _buildLoop(step: Step, container: HTMLDivElement): CommitResult {
        const row = document.createElement('div')
        row.className = 'sep-row'
        const label = document.createElement('span')
        label.className = 'sep-lbl'
        label.textContent = 'Iterations'
        const numberInput = document.createElement('rokdock-number-input')
        numberInput.setAttribute('min', '1')
        numberInput.setAttribute('step', '1')
        numberInput.setAttribute('value', String((step as LoopStep).iterations ?? 1))
        row.appendChild(label)
        row.appendChild(numberInput)
        container.appendChild(row)

        const hint = document.createElement('span')
        hint.className = 'sep-hint'
        hint.textContent = 'Nested steps are edited inline in the list.'
        container.appendChild(hint)

        return {
            commitFn: () => ({
                ...step,
                iterations: Math.max(1, Math.round((numberInput as unknown as { value: number }).value || 1))
            } as Step)
        }
    }

    private _buildWaitPlayerState(step: Step, container: HTMLDivElement): CommitResult {
        const stepData = step as { state?: string; timeoutMs?: number; intervalMs?: number }

        const row1 = document.createElement('div')
        row1.className = 'sep-row'
        const lbl1 = document.createElement('span')
        lbl1.className = 'sep-lbl'
        lbl1.textContent = 'State'
        const stateSelect = document.createElement('rokdock-select')
        stateSelect.setAttribute('value', stepData.state ?? 'play')
        for (const state of ['play', 'pause', 'stop', 'buffering', 'finished']) {
            const opt = document.createElement('option')
            opt.value = state
            opt.textContent = state
            stateSelect.appendChild(opt)
        }
        row1.appendChild(lbl1)
        row1.appendChild(stateSelect)
        container.appendChild(row1)

        const row2 = document.createElement('div')
        row2.className = 'sep-row'
        const lbl2 = document.createElement('span')
        lbl2.className = 'sep-lbl'
        lbl2.textContent = 'Timeout'
        const timeoutInput = document.createElement('rokdock-number-input')
        timeoutInput.setAttribute('min', '1')
        timeoutInput.setAttribute('step', '1')
        timeoutInput.setAttribute('value', String(Math.round((stepData.timeoutMs ?? 30000) / 1000)))
        const hint2 = document.createElement('span')
        hint2.className = 'sep-hint'
        hint2.textContent = 's'
        row2.appendChild(lbl2)
        row2.appendChild(timeoutInput)
        row2.appendChild(hint2)
        container.appendChild(row2)

        const row3 = document.createElement('div')
        row3.className = 'sep-row'
        const lbl3 = document.createElement('span')
        lbl3.className = 'sep-lbl'
        lbl3.textContent = 'Poll interval'
        const pollInput = document.createElement('rokdock-number-input')
        pollInput.setAttribute('min', '0.5')
        pollInput.setAttribute('step', '0.5')
        pollInput.setAttribute('value', String(((stepData.intervalMs ?? 2000) / 1000).toFixed(1)))
        const hint3 = document.createElement('span')
        hint3.className = 'sep-hint'
        hint3.textContent = 's'
        row3.appendChild(lbl3)
        row3.appendChild(pollInput)
        row3.appendChild(hint3)
        container.appendChild(row3)

        return {
            commitFn: () => ({
                ...step,
                state: (stateSelect as unknown as { value: string }).value,
                timeoutMs: Math.round(Math.max(1, (timeoutInput as unknown as { value: number }).value || 30) * 1000),
                intervalMs: Math.round(Math.max(0.5, (pollInput as unknown as { value: number }).value || 2) * 1000)
            } as Step)
        }
    }

    private _buildValidateStreaming(step: Step, container: HTMLDivElement): CommitResult {
        const stepData = step as {
            videoCodec?: string; audioCodec?: string; drm?: string
            skipVideoValidation?: boolean; skipBitrateValidation?: boolean; onNotPlaying?: string
        }

        type CodecOption = { value: string; label: string }
        type CodecRowResult = { row: HTMLDivElement; getValue: () => string | undefined }

        const codecRow = (label: string, currentValue: string | undefined, options: CodecOption[]): CodecRowResult => {
            const row = document.createElement('div')
            row.className = 'sep-row'
            const labelElement = document.createElement('span')
            labelElement.className = 'sep-lbl'
            labelElement.textContent = label

            const knownValues = options.map(option => option.value)
            const isCustom = !!(currentValue && !knownValues.includes(currentValue))
            const selectValue = isCustom ? '__custom__' : (currentValue ?? '')

            const selectElement = document.createElement('rokdock-select')
            selectElement.setAttribute('value', selectValue)
            for (const option of options) {
                const opt = document.createElement('option')
                opt.value = option.value
                opt.textContent = option.label
                selectElement.appendChild(opt)
            }
            const customOpt = document.createElement('option')
            customOpt.value = '__custom__'
            customOpt.textContent = 'Custom...'
            selectElement.appendChild(customOpt)

            const customInput = document.createElement('input')
            customInput.className = 'ed-inp'
            customInput.type = 'text'
            customInput.value = isCustom ? (currentValue ?? '') : ''
            customInput.placeholder = 'Custom value'
            customInput.style.cssText = 'width:90px;font-family:var(--rokdock-font-mono);font-size:var(--rokdock-font-sm);display:' + (isCustom ? 'block' : 'none') + ';'

            selectElement.addEventListener('rokdock-change', (e: Event) => {
                customInput.style.display = (e as CustomEvent<{ value: string }>).detail.value === '__custom__' ? 'block' : 'none'
            })

            row.appendChild(labelElement)
            row.appendChild(selectElement)
            row.appendChild(customInput)

            const getValue = (): string | undefined => {
                const value = (selectElement as unknown as { value: string }).value
                if (value === '__custom__') return customInput.value || undefined
                if (value === '') return undefined
                return value
            }
            return { row, getValue }
        }

        const videoCodecs: CodecOption[] = [
            { value: '', label: '(any)' }, { value: 'hevc', label: 'hevc' }, { value: 'hevc_b', label: 'hevc_b' },
            { value: 'mpeg1', label: 'mpeg1' }, { value: 'mpeg2', label: 'mpeg2' }, { value: 'mpeg4_2', label: 'mpeg4_2' },
            { value: 'mpeg4_10b', label: 'mpeg4_10b' }, { value: 'mpeg4_15', label: 'mpeg4_15' },
            { value: 'vc1', label: 'vc1' }, { value: 'wmv', label: 'wmv' }, { value: 'vp8', label: 'vp8' }, { value: 'vp9', label: 'vp9' }
        ]
        const audioCodecs: CodecOption[] = [
            { value: '', label: '(any)' }, { value: 'aac', label: 'aac' }, { value: 'aac_adif', label: 'aac_adif' },
            { value: 'aac_adts', label: 'aac_adts' }, { value: 'aac_latm', label: 'aac_latm' }, { value: 'ac3', label: 'ac3' },
            { value: 'alac', label: 'alac' }, { value: 'dts', label: 'dts' }, { value: 'eac3', label: 'eac3' },
            { value: 'flac', label: 'flac' }, { value: 'mp2', label: 'mp2' }, { value: 'mp3', label: 'mp3' },
            { value: 'pcm', label: 'pcm' }, { value: 'vorbis', label: 'vorbis' }, { value: 'wma', label: 'wma' }, { value: 'wmapro', label: 'wmapro' }
        ]
        const drmOptions: CodecOption[] = [
            { value: '', label: 'none' }, { value: 'playready', label: 'playready' },
            { value: 'adobe drm', label: 'adobe drm' }, { value: 'verimatrix', label: 'verimatrix' }, { value: 'aes-128', label: 'aes-128' }
        ]
        const ifNotPlayingOptions: CodecOption[] = [
            { value: 'fail', label: 'fail' }, { value: 'skip', label: 'skip' }, { value: 'wait', label: 'wait' }
        ]

        const videoRow = codecRow('Video codec', stepData.videoCodec, videoCodecs)
        const audioRow = codecRow('Audio codec', stepData.audioCodec, audioCodecs)
        const drmRow = codecRow('DRM', stepData.drm, drmOptions)
        container.appendChild(videoRow.row)
        container.appendChild(audioRow.row)
        container.appendChild(drmRow.row)

        const divider1 = document.createElement('hr')
        divider1.className = 'sep-divider'
        container.appendChild(divider1)

        const skipVideoRow = document.createElement('div')
        skipVideoRow.className = 'sep-row'
        const skipVideoToggle = document.createElement('rokdock-toggle')
        if (stepData.skipVideoValidation) skipVideoToggle.setAttribute('checked', '')
        skipVideoToggle.textContent = 'Skip video validation'
        skipVideoRow.appendChild(skipVideoToggle)
        container.appendChild(skipVideoRow)

        const skipBitrateRow = document.createElement('div')
        skipBitrateRow.className = 'sep-row'
        const skipBitrateToggle = document.createElement('rokdock-toggle')
        if (stepData.skipBitrateValidation) skipBitrateToggle.setAttribute('checked', '')
        skipBitrateToggle.textContent = 'Skip bitrate validation'
        skipBitrateRow.appendChild(skipBitrateToggle)
        container.appendChild(skipBitrateRow)

        const divider2 = document.createElement('hr')
        divider2.className = 'sep-divider'
        container.appendChild(divider2)

        const ifNotRow = document.createElement('div')
        ifNotRow.className = 'sep-row'
        const ifNotLbl = document.createElement('span')
        ifNotLbl.className = 'sep-lbl'
        ifNotLbl.textContent = 'If not playing'
        const ifNotSel = document.createElement('rokdock-select')
        ifNotSel.setAttribute('value', stepData.onNotPlaying ?? 'fail')
        for (const option of ifNotPlayingOptions) {
            const opt = document.createElement('option')
            opt.value = option.value
            opt.textContent = option.label
            ifNotSel.appendChild(opt)
        }
        ifNotRow.appendChild(ifNotLbl)
        ifNotRow.appendChild(ifNotSel)
        container.appendChild(ifNotRow)

        return {
            commitFn: () => ({
                ...step,
                videoCodec: videoRow.getValue(),
                audioCodec: audioRow.getValue(),
                drm: drmRow.getValue(),
                skipVideoValidation: (skipVideoToggle as unknown as { checked: boolean }).checked || undefined,
                skipBitrateValidation: (skipBitrateToggle as unknown as { checked: boolean }).checked || undefined,
                onNotPlaying: (ifNotSel as unknown as { value: string }).value
            } as Step)
        }
    }

    private _buildChannelTileOrder(step: Step, container: HTMLDivElement): CommitResult {
        const channels: string[] = [...((step as { channels?: string[] }).channels ?? [])]

        const hdrRow = document.createElement('div')
        hdrRow.className = 'sep-row'
        hdrRow.style.justifyContent = 'space-between'
        const hdrLbl = document.createElement('span')
        hdrLbl.className = 'sep-lbl'
        hdrLbl.style.minWidth = '0'
        hdrLbl.textContent = 'Channel order'
        const addChannelButton = document.createElement('button')
        addChannelButton.className = 'ed-btn'
        addChannelButton.textContent = '+ Add'
        hdrRow.appendChild(hdrLbl)
        hdrRow.appendChild(addChannelButton)
        container.appendChild(hdrRow)

        const list = document.createElement('div')
        list.className = 'sep-ch-list'
        container.appendChild(list)

        let dragSourceIndex: number | null = null

        const renderList = (): void => {
            list.innerHTML = ''
            if (channels.length === 0) {
                const empty = document.createElement('span')
                empty.className = 'sep-ch-empty'
                empty.textContent = 'No channels'
                list.appendChild(empty)
                return
            }
            channels.forEach((channel, idx) => {
                const channelRow = document.createElement('div')
                channelRow.className = 'sep-ch-row'
                channelRow.draggable = true

                const drag = document.createElement('span')
                drag.className = 'sep-ch-drag'
                drag.innerHTML = '&#8286;'

                const name = document.createElement('span')
                name.className = 'sep-ch-name'
                name.textContent = channel
                name.title = channel

                const removeBtn = document.createElement('button')
                removeBtn.className = 'sep-ch-remove'
                removeBtn.textContent = 'x'
                removeBtn.addEventListener('click', () => { channels.splice(idx, 1); renderList() })

                channelRow.addEventListener('dragstart', () => { dragSourceIndex = idx; channelRow.style.opacity = '0.4' })
                channelRow.addEventListener('dragend', () => { channelRow.style.opacity = '' })
                channelRow.addEventListener('dragover', (e: DragEvent) => { e.preventDefault() })
                channelRow.addEventListener('drop', () => {
                    if (dragSourceIndex === null || dragSourceIndex === idx) return
                    const moved = channels.splice(dragSourceIndex, 1)[0]
                    channels.splice(idx, 0, moved)
                    dragSourceIndex = null
                    renderList()
                })

                channelRow.appendChild(drag)
                channelRow.appendChild(name)
                channelRow.appendChild(removeBtn)
                list.appendChild(channelRow)
            })
        }
        renderList()

        addChannelButton.addEventListener('click', () => {
            if (!selectedDeviceIp) {
                const selectElement = document.getElementById('remote-device-select') as HTMLSelectElement
                selectElement.focus()
                if ((selectElement as { showPicker?: () => void }).showPicker) (selectElement as { showPicker: () => void }).showPicker()
                return
            }
            void showChannelPicker(selectedDeviceIp).then(picked => {
                if (picked) {
                    channels.push(picked.name + (picked.id ? ' (' + picked.id + ')' : ''))
                    renderList()
                }
            })
        })

        return { commitFn: () => ({ ...step, channels: channels.slice() } as Step) }
    }

    private _buildComment(step: Step, container: HTMLDivElement): CommitResult {
        const field = document.createElement('div')
        field.style.cssText = 'display:flex;flex-direction:column;gap:4px;'

        const label = document.createElement('span')
        label.style.cssText = 'font-size:var(--rokdock-font-sm);color:var(--rokdock-text-muted);text-transform:uppercase;letter-spacing:.05em;'
        label.textContent = 'Text'

        const textarea = document.createElement('textarea')
        textarea.className = 'ed-inp'
        textarea.style.cssText = 'width:100%;min-height:72px;resize:vertical;padding:6px 8px;font-family:var(--rokdock-font-ui);font-style:italic;line-height:1.5;box-sizing:border-box;'
        textarea.value = (step as { text?: string }).text ?? ''
        textarea.placeholder = 'Comment text...'

        const hint = document.createElement('span')
        hint.className = 'sep-hint'
        hint.textContent = 'Exported as # text in RASP - no playback effect'

        field.appendChild(label)
        field.appendChild(textarea)
        field.appendChild(hint)
        container.appendChild(field)

        return { commitFn: () => ({ ...step, text: textarea.value } as Step) }
    }

    private _buildReadOnly(step: Step, container: HTMLDivElement): CommitResult {
        const note = document.createElement('span')
        note.className = 'sep-readonly-note'
        note.textContent = 'Imported step - not supported in new scripts.'
        container.appendChild(note)

        const entries = Object.keys(step).filter(k => k !== 'type' && k !== 'annotations' && k !== 'disabled')
        for (const key of entries) {
            const value = (step as unknown as Record<string, unknown>)[key]
            const row = document.createElement('div')
            row.className = 'sep-row'
            const label = document.createElement('span')
            label.className = 'sep-lbl'
            label.textContent = key
            const valueElement = document.createElement('span')
            valueElement.style.cssText = 'font-size:var(--rokdock-font-sm);color:var(--rokdock-text-primary);font-family:var(--rokdock-font-mono);'
            valueElement.textContent = typeof value === 'object' ? JSON.stringify(value) : String(value)
            row.appendChild(label)
            row.appendChild(valueElement)
            container.appendChild(row)
        }

        return { commitFn: null }
    }
}

// --- stepEditorPopup (assigned in init) ---

let stepEditorPopup: StepEditorPopup

// --- getInitialData ---

async function getInitialData(): Promise<InitialData> {
    const raw = await window.rokdock.scriptEditor.getInitialData() as {
        script?: ScriptFile
        initialFilePath?: string | null
        initialDeviceIp?: string
        startRecording?: boolean
        initialError?: string | null
        initialWarnings?: string[]
    }
    return {
        script: raw.script ?? blankScript(),
        initialFilePath: raw.initialFilePath ?? null,
        initialDeviceIp: raw.initialDeviceIp ?? '',
        startRecording: raw.startRecording ?? false,
        initialError: raw.initialError ?? null,
        initialWarnings: raw.initialWarnings ?? []
    }
}

// --- Device indicator ---

function updateDeviceIndicator(): void {
    const remoteElement = document.getElementById('remote-component') as HTMLElement
    const dot = document.getElementById('keys-dot') as HTMLElement
    const txt = document.getElementById('keys-status-text') as HTMLElement
    if (selectedDeviceIp) {
        remoteElement.setAttribute('device', selectedDeviceIp)
    } else {
        remoteElement.removeAttribute('device')
    }
    const keysActive = remoteElement.hasAttribute('keys-active')
    if (keysActive) {
        dot.classList.add('connected')
        txt.textContent = 'Keys on'
    } else {
        dot.classList.remove('connected')
        txt.textContent = selectedDeviceIp ? 'Keys off' : 'No device'
    }
}

// --- Script state helpers ---

function updateMetaFields(): void {
    const wait = script.metadata?.defaultKeypressWait ?? 1
    const input = document.getElementById('keypress-wait-inp') as HTMLInputElement
    if (input) input.value = String(wait)
}

function updateScriptName(): void {
    const element = document.getElementById('script-name-text')
    if (element) element.textContent = script.name || '(untitled)'
    document.title = 'Script Editor - ' + script.name
    updateMetaFields()
}

function updateToolbarState(): void {
    const playButton = document.getElementById('play-btn') as HTMLButtonElement
    const stopButton = document.getElementById('stop-btn') as HTMLButtonElement
    if (playButton) playButton.disabled = isPlaying || script.steps.length === 0
    if (stopButton) stopButton.disabled = !isPlaying
}

function scrollToBottom(): void {
    const list = document.getElementById('step-list') as HTMLElement
    list.scrollTop = list.scrollHeight
}

// --- Selection helpers ---

function isSelected(path: (number | string)[]): boolean {
    return selectedSet.has(JSON.stringify(path))
}

function selectPath(path: (number | string)[]): void {
    selectedSet.add(JSON.stringify(path))
    lastClickedPath = path as number[]
    updateSelectionBar()
}

function deselectPath(path: (number | string)[]): void {
    selectedSet.delete(JSON.stringify(path))
    updateSelectionBar()
}

function clearSelection(): void {
    selectedSet.clear()
    lastClickedPath = null
    updateSelectionBar()
    document.querySelectorAll('.step-row.selected').forEach(row => row.classList.remove('selected'))
}

function getPathsBetween(fromPath: number[], toPath: number[]): number[][] {
    const allPaths: number[][] = []
    const walk = (steps: Step[], parentPath: number[]): void => {
        steps.forEach((step, i) => {
            const childPath = [...parentPath, i]
            allPaths.push(childPath)
            if ((step as LoopStep).steps) walk((step as LoopStep).steps!, childPath)
        })
    }
    walk(script.steps, [])
    const fromKey = JSON.stringify(fromPath)
    const toKey = JSON.stringify(toPath)
    const fromIdx = allPaths.findIndex(candidate => JSON.stringify(candidate) === fromKey)
    const toIdx = allPaths.findIndex(candidate => JSON.stringify(candidate) === toKey)
    if (fromIdx === -1 || toIdx === -1) return [toPath]
    const lo = Math.min(fromIdx, toIdx)
    const hi = Math.max(fromIdx, toIdx)
    return allPaths.slice(lo, hi + 1)
}

function getSelectedPaths(): number[][] {
    const all: number[][] = []
    const walk = (steps: Step[], parentPath: number[]): void => {
        steps.forEach((step, i) => {
            const childPath = [...parentPath, i]
            if (isSelected(childPath)) all.push(childPath)
            if ((step as LoopStep).steps) walk((step as LoopStep).steps!, childPath)
        })
    }
    walk(script.steps, [])
    return all
}

function updateSelectionBar(): void {
    const bar = document.getElementById('sel-bar')
    if (!bar) return
    const count = selectedSet.size
    if (count < 2) {
        bar.style.display = 'none'
        return
    }
    bar.style.display = 'flex'
    const countElement = document.getElementById('sel-count')
    if (countElement) countElement.textContent = count + ' steps selected'
}

// --- Step mutation helpers ---

function getStepAt(path: (number | string)[]): { arr: Step[]; idx: number } {
    let arr = script.steps
    let i = 0
    while (i < path.length - 1) {
        const seg = path[i]
        const step = arr[seg as number] as LoopStep & { onError?: Step[] }
        const nextSeg = path[i + 1]
        if (nextSeg === 'e') {
            arr = step.onError!
            i += 2
        } else {
            arr = step.steps!
            i += 1
        }
    }
    return { arr, idx: path[path.length - 1] as number }
}

function setNestedStep(path: (number | string)[], newStep: Step): void {
    const { arr, idx } = getStepAt(path)
    arr[idx] = newStep
    markDirty()
    renderStepList()
    updateToolbarState()
}

function deleteStep(path: (number | string)[]): void {
    const { arr, idx } = getStepAt(path)
    arr.splice(idx, 1)
    markDirty()
    renderStepList()
    updateToolbarState()
}

function insertStepAt(path: (number | string)[], step: Step, position: string): void {
    markDirty()
    let newPath: (number | string)[]
    if (position === 'after') {
        const ref = getStepAt(path)
        ref.arr.splice((ref.idx as number) + 1, 0, step)
        newPath = [...path.slice(0, -1), (path[path.length - 1] as number) + 1]
    } else if (position === 'before') {
        const ref = getStepAt(path)
        ref.arr.splice(ref.idx as number, 0, step)
        newPath = [...path]
    } else {
        script.steps.push(step)
        newPath = [script.steps.length - 1]
    }
    renderStepList()
    updateToolbarState()
    const row = document.querySelector(".step-row[data-path='" + JSON.stringify(newPath) + "']") as HTMLElement | null
    if (row) stepEditorPopup.open(step, row, newPath, null, true)
}

function ungroupLoop(path: (number | string)[]): void {
    const { arr, idx } = getStepAt(path)
    const loop = arr[idx] as LoopStep
    arr.splice(idx, 1, ...(loop.steps ?? []))
    markDirty()
    renderStepList()
    updateToolbarState()
}

function duplicateSteps(paths: number[][]): void {
    const sorted = paths.slice().sort(comparePathsDescending)
    sorted.forEach(path => {
        const stepRef = getStepAt(path)
        const copy = JSON.parse(JSON.stringify(stepRef.arr[stepRef.idx])) as Step
        stepRef.arr.splice((stepRef.idx as number) + 1, 0, copy)
    })
    markDirty()
    renderStepList()
    updateToolbarState()
}

function groupSelectionIntoLoop(paths: number[][]): void {
    if (!paths || paths.length === 0) return

    const parents = paths.map(path => JSON.stringify(path.slice(0, -1)))
    const uniqueParents = new Set(parents)
    if (uniqueParents.size > 1) {
        if (!confirm('Selection crosses a loop boundary. Create a new loop from these ' + paths.length + ' steps? The selected steps will be moved out of their current groups.')) return
    }

    const sorted = paths.slice().sort(comparePathsDescending)
    const forward = sorted.slice().reverse()
    const stepsToGroup = forward.map(path => JSON.parse(JSON.stringify(getStepAt(path).arr[getStepAt(path).idx])) as Step)
    const insertAt = [...forward[0]]

    sorted.forEach(path => {
        const ref = getStepAt(path)
        ref.arr.splice(ref.idx as number, 1)
    })

    const parentRef = insertAt.length > 1 ? getStepAt(insertAt.slice(0, -1)) : null
    const parentArr = parentRef ? (parentRef.arr[parentRef.idx] as LoopStep).steps! : script.steps
    const insertIdx = Math.min(insertAt[insertAt.length - 1] as number, parentArr.length)

    const loopStep: Step = { type: 'loop', iterations: 1, steps: stepsToGroup } as unknown as Step
    parentArr.splice(insertIdx, 0, loopStep)

    markDirty()
    renderStepList()
    updateToolbarState()

    const loopPath = [...insertAt.slice(0, -1), insertIdx]
    const loopRow = document.querySelector(".group-hdr[data-path='" + JSON.stringify(loopPath) + "']") as HTMLElement | null
    if (loopRow) stepEditorPopup.open(loopStep, loopRow, loopPath)
}

function findAllBlockRefs(steps: Step[], name: string, pathPrefix: (number | string)[]): (number | string)[][] {
    let refs: (number | string)[][] = []
    steps.forEach((step, i) => {
        const childPath = [...pathPrefix, i]
        if (step.type === 'block-ref' && (step as { name?: string }).name === name) refs.push(childPath)
        if ((step as LoopStep).steps?.length) {
            refs = refs.concat(findAllBlockRefs((step as LoopStep).steps!, name, childPath))
        }
        if ((step as { onError?: Step[] }).onError?.length) {
            refs = refs.concat(findAllBlockRefs((step as { onError: Step[] }).onError, name, [...childPath, 'e']))
        }
    })
    return refs
}

function groupSelectionAsBlock(name: string): void {
    const paths = getSelectedPaths()
    if (!paths.length) return
    paths.sort((pathA, pathB) => pathA[pathA.length - 1] - pathB[pathB.length - 1])
    const firstPath = paths[0]
    const result = getStepAt(firstPath)
    const arr = result.arr
    const indices = paths.map(path => path[path.length - 1])
    const selectedSteps = indices.map(idx => arr[idx])
    for (let i = indices.length - 1; i >= 0; i--) {
        arr.splice(indices[i], 1)
    }
    const block = { type: 'block', name, steps: selectedSteps } as unknown as Step
    arr.splice(indices[0], 0, block)
    clearSelection()
    renderStepList()
    updateToolbarState()
}

function dissolveBlock(blockPath: (number | string)[]): void {
    const result = getStepAt(blockPath)
    const arr = result.arr
    const idx = result.idx
    const block = arr[idx] as { type: string; name: string; steps: Step[] }
    if (!block || block.type !== 'block') return
    const refCount = findAllBlockRefs(script.steps, block.name, []).length
    let msg = 'Dissolve block "' + block.name + '" (inline its ' + block.steps.length + ' step(s))?'
    if (refCount > 0) msg += ' This will also remove ' + refCount + ' reference(s).'
    if (!confirm(msg)) return
    const refs = findAllBlockRefs(script.steps, block.name, [])
    refs.sort((pathA, pathB) => comparePathsDescending(pathA, pathB))
    refs.forEach(refPath => {
        const ref = getStepAt(refPath)
        ref.arr.splice(ref.idx as number, 1)
    })
    arr.splice(idx, 1, ...block.steps)
    clearSelection()
    renderStepList()
    updateToolbarState()
}

function deleteBlockWithRefs(blockName: string, blockPath: (number | string)[]): void {
    const result = getStepAt(blockPath)
    result.arr.splice(result.idx as number, 1)
    const remainingRefs = findAllBlockRefs(script.steps, blockName, [])
    remainingRefs.sort((pathA, pathB) => comparePathsDescending(pathA, pathB))
    remainingRefs.forEach(refPath => {
        const ref = getStepAt(refPath)
        ref.arr.splice(ref.idx as number, 1)
    })
    clearSelection()
    renderStepList()
    updateToolbarState()
}

function renameBlock(blockPath: (number | string)[], newName: string): void {
    const result = getStepAt(blockPath)
    const arr = result.arr
    const idx = result.idx
    const block = arr[idx] as { type: string; name: string; steps: Step[] }
    if (!block || block.type !== 'block') return
    const oldName = block.name
    const updateRefs = (steps: Step[]): void => {
        steps.forEach(step => {
            if (step.type === 'block-ref' && (step as { name?: string }).name === oldName) {
                (step as { name: string }).name = newName
            }
            if ((step as LoopStep).steps) updateRefs((step as LoopStep).steps!)
        })
    }
    updateRefs(script.steps)
    arr[idx] = { ...arr[idx], name: newName } as Step
    renderStepList()
    updateToolbarState()
}

function moveOutOfLoop(paths: number[][]): void {
    if (!paths || paths.length === 0) return
    const validPaths = paths.filter(path => path.length > 1)
    if (validPaths.length === 0) return

    const forward = validPaths.slice().sort(comparePathsAscending)
    const stepsToMove = forward.map(path => JSON.parse(JSON.stringify(getStepAt(path).arr[getStepAt(path).idx])) as Step)

    forward.slice().reverse().forEach(path => {
        const ref = getStepAt(path)
        ref.arr.splice(ref.idx as number, 1)
    })

    const firstPath = forward[0]
    const loopPath = firstPath.slice(0, -1)
    const insertIdx = loopPath[loopPath.length - 1] + 1
    const parentArr = loopPath.length > 1
        ? (getStepAt(loopPath.slice(0, -1)).arr[getStepAt(loopPath.slice(0, -1)).idx] as LoopStep).steps!
        : script.steps

    stepsToMove.forEach((step, i) => {
        parentArr.splice(insertIdx + i, 0, step)
    })

    renderStepList()
    updateToolbarState()
}

function moveStepsToBefore(paths: number[][], targetPath: number[]): void {
    const forward = paths.slice().sort(comparePathsAscending)
    const steps = forward.map(path => JSON.parse(JSON.stringify(getStepAt(path).arr[getStepAt(path).idx])) as Step)

    forward.slice().reverse().forEach(path => {
        const ref = getStepAt(path)
        ref.arr.splice(ref.idx as number, 1)
    })

    const dst = getStepAt(targetPath)
    steps.reverse().forEach(step => {
        dst.arr.splice(dst.idx as number, 0, step)
    })

    renderStepList()
    updateToolbarState()
}

function addErrorHandler(path: (number | string)[], capturedStep?: Step): void {
    const stepData = capturedStep ?? (() => { const ref = getStepAt(path); return ref.arr[ref.idx] })()
    if ((stepData as { onError?: Step[] }).onError !== undefined) return
    const result = getStepAt(path)
    result.arr[result.idx] = { ...stepData, onError: [] } as unknown as Step
    renderStepList()
    updateToolbarState()
    const header = document.querySelector('[data-on-error-hdr="1"][data-path="' + JSON.stringify(path) + '"]') as HTMLElement | null
    if (header) showStepPicker(header, [...path, 'e', 0], 'append')
}

function deleteSteps(paths: number[][]): void {
    const sorted = paths.slice().sort(comparePathsDescending)
    sorted.forEach(path => deleteStep(path))
}

// --- Step list rendering ---

function renderStepList(): void {
    selectedSet.clear()
    lastClickedPath = null
    const list = document.getElementById('step-list') as HTMLElement

    document.querySelectorAll('.group-collapse.collapsed').forEach(button => {
        const header = (button as HTMLElement).closest('[data-path]') as HTMLElement | null
        if (header?.dataset.path) collapsedSet.add(header.dataset.path)
    })

    const expandedRow = document.querySelector('.step-row.expanded') as HTMLElement | null
    const expandedPath = expandedRow ? expandedRow.dataset.path ?? null : null

    const emptyElement = document.getElementById('step-list-empty') as HTMLElement
    list.innerHTML = ''
    list.appendChild(emptyElement)

    renderSteps(script.steps, list, [])

    list.querySelectorAll('[data-path]').forEach(element => {
        const pathKey = (element as HTMLElement).dataset.path
        if (pathKey && collapsedSet.has(pathKey)) {
            const button = element.querySelector('.group-collapse') as HTMLElement | null
            const body = element.nextElementSibling as HTMLElement | null
            if (button && body) {
                button.classList.add('collapsed')
                body.style.display = 'none'
            }
        }
    })

    if (expandedPath) {
        const row = list.querySelector(".step-row[data-path='" + expandedPath + "']") as HTMLElement | null
        if (row) row.classList.add('expanded')
    }

    const count = script.steps.length
    const isEmpty = count === 0
    emptyElement.style.display = isEmpty ? '' : 'none'

    const badge = document.getElementById('step-count')
    if (badge) badge.textContent = String(count)

    const statusBarSteps = document.getElementById('sb-steps')
    if (statusBarSteps) statusBarSteps.textContent = count > 0 ? count + ' step' + (count === 1 ? '' : 's') : ''

    renderVariables()
    syncScannedVariables()
    updateSelectionBar()
}

function renderSteps(steps: Step[], container: HTMLElement, path: number[]): void {
    steps.forEach((step, i) => {
        const indexPath = [...path, i]
        if (step.type === 'loop') {
            renderGroupHeader(step as LoopStep, i, indexPath, container, path.length)
        } else if (step.type === 'block') {
            renderBlockHeader(step as BlockDefinitionStep, i, indexPath, container, path.length)
        } else if (step.type === 'block-ref') {
            renderBlockRefRow(step, i, indexPath, container, path.length)
        } else {
            renderStepRow(step, i, indexPath, container, path.length)
        }
    })
}

function appendStep(step: Step): void {
    script.steps.push(step)
    markDirty()
    renderStepList()
    updateToolbarState()
    scrollToBottom()
    if (!isRecording) {
        const newPath = [script.steps.length - 1]
        const row = document.querySelector(".step-row[data-path='" + JSON.stringify(newPath) + "']") as HTMLElement | null
        if (row) stepEditorPopup.open(step, row, newPath, null, true)
    }
    if (isRecording) {
        recStepCount++
        const element = document.getElementById('rec-step-count')
        if (element) element.textContent = recStepCount + (recStepCount === 1 ? ' step' : ' steps')
    }
}

function renderStepRow(step: Step, i: number, indexPath: number[], container: HTMLElement, depth: number): void {
    const row = document.createElement('div')
    row.className = 'step-row'
    row.dataset.path = JSON.stringify(indexPath)
    if (isSelected(indexPath)) row.classList.add('selected')
    row.dataset.t = getStepTypeAttribute(step.type)

    const annotations = (step as { annotations?: StepAnnotation[] }).annotations
    const hasWarn = annotations?.some(annotation => annotation.level === 'warning')
    const warnHtml = hasWarn
        ? '<span class="step-warn" title="' + escapeHtml(annotations!.find(annotation => annotation.level === 'warning')?.message ?? '') + '">' + iconWarn + '</span>'
        : ''

    const stepNumberClass = depth > 0 ? 'step-num sub' : 'step-num'
    const isDisabled = (step as { disabled?: boolean }).disabled

    if (step.type === 'comment') {
        row.innerHTML =
            '<div class="drag-handle">&#8286;</div>' +
            '<span class="' + stepNumberClass + '">' + stepLabel(indexPath) + '</span>' +
            '<span class="step-st" data-status></span>' +
            '<input type="checkbox" class="step-cb"' + (isDisabled ? '' : ' checked') + '>' +
            '<span class="comment-hash">#</span>' +
            '<span class="comment-text">' + escapeHtml((step as { text?: string }).text ?? '') + '</span>' +
            '<div class="step-acts">' +
            '<button class="act" data-action="edit" title="Edit step">' + iconEdit + '</button>' +
            '<button class="act" data-action="add-before" title="Add step before">' + iconAddBefore + '</button>' +
            '<button class="act" data-action="add-after" title="Add step after">' + iconAddAfter + '</button>' +
            '<button class="act del" data-action="delete" title="Delete step">' + iconTrash + '</button>' +
            '</div>'
    } else {
        row.innerHTML =
            '<div class="drag-handle">&#8286;</div>' +
            '<span class="' + stepNumberClass + '">' + stepLabel(indexPath) + '</span>' +
            '<span class="step-st" data-status></span>' +
            '<input type="checkbox" class="step-cb"' + (isDisabled ? '' : ' checked') + '>' +
            '<span class="chip ' + chipKey(step.type) + '">' + chipLabel(step.type) + '</span>' +
            '<span class="summary">' + stepSummaryHtml(step, script.metadata) + '</span>' +
            warnHtml +
            '<div class="step-acts">' +
            '<button class="act" data-action="edit" title="Edit step">' + iconEdit + '</button>' +
            '<button class="act" data-action="add-before" title="Add step before">' + iconAddBefore + '</button>' +
            '<button class="act" data-action="add-after" title="Add step after">' + iconAddAfter + '</button>' +
            '<button class="act del" data-action="delete" title="Delete step">' + iconTrash + '</button>' +
            '</div>'
    }

    if (isDisabled) row.classList.add('disabled')

    row.addEventListener('click', (e: MouseEvent) => {
        if ((e.target as HTMLElement).closest('.drag-handle')) return
        if ((e.target as HTMLElement).classList.contains('step-cb')) {
            const newDisabled = !(e.target as HTMLInputElement).checked
            setNestedStep(indexPath, { ...step, disabled: newDisabled || undefined } as Step)
            return
        }
        if (!(e.target as HTMLElement).closest('.drag-handle, .step-cb, [data-action]')) {
            applyStepSelection(e, indexPath)
            return
        }
        const action = (e.target as HTMLElement).closest('[data-action]')
        const actionName = action ? (action as HTMLElement).dataset.action : null
        if (actionName === 'edit') { stepEditorPopup.open(step, row, indexPath, e); return }
        if (actionName === 'delete') { deleteStep(indexPath); return }
        if (actionName === 'add-before') { showStepPicker(row, indexPath, 'before'); return }
        if (actionName === 'add-after') { showStepPicker(row, indexPath, 'after'); return }
    })

    row.addEventListener('dblclick', (e: MouseEvent) => {
        if ((e.target as HTMLElement).closest('.drag-handle, .step-cb, [data-action]')) return
        stepEditorPopup.open(step, row, indexPath, e)
    })

    row.addEventListener('contextmenu', (e: MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()

        const selectedPaths = getSelectedPaths()
        const isMulti = selectedPaths.length > 1 && isSelected(indexPath)

        if (isMulti) {
            const count = selectedPaths.length
            contextMenu.show(e.clientX, e.clientY, [
                { label: 'Duplicate (' + count + ' steps)', action: () => duplicateSteps(selectedPaths) },
                { isSep: true },
                (() => {
                    const allInsideLoop = selectedPaths.every(path => path.length > 1)
                    return {
                        label: allInsideLoop ? 'Move out of loop' : 'Group into loop',
                        action: allInsideLoop
                            ? () => moveOutOfLoop(selectedPaths)
                            : () => groupSelectionIntoLoop(selectedPaths)
                    }
                })(),
                {
                    label: 'Group as block...', action: () => {
                        const prompt = document.getElementById('block-name-prompt') as HTMLElement
                        ;(document.getElementById('block-name-input') as HTMLInputElement).value = ''
                        document.getElementById('block-name-err')?.classList.remove('visible')
                        prompt.classList.add('visible')
                        ;(document.getElementById('block-name-input') as HTMLInputElement).focus()
                    }
                },
                { isSep: true },
                { label: 'Delete (' + count + ' steps)', danger: true, action: () => deleteSteps(selectedPaths) },
            ])
        } else {
            if (!isSelected(indexPath)) {
                clearSelection()
                selectPath(indexPath)
                row.classList.add('selected')
                updateSelectionBar()
            }
            const allInLoop = indexPath.length > 1
            contextMenu.show(e.clientX, e.clientY, [
                { label: 'Edit step', action: () => stepEditorPopup.open(step, row, indexPath, e) },
                { isSep: true },
                { label: 'Add step before', action: () => showStepPicker(row, indexPath, 'before') },
                { label: 'Add step after', action: () => showStepPicker(row, indexPath, 'after') },
                { label: 'Duplicate', action: () => duplicateSteps([indexPath]) },
                { isSep: true },
                {
                    label: allInLoop ? 'Move out of loop' : 'Group into loop',
                    action: allInLoop
                        ? () => moveOutOfLoop([indexPath])
                        : () => groupSelectionIntoLoop([indexPath])
                },
                {
                    label: 'Group as block...', action: () => {
                        const prompt = document.getElementById('block-name-prompt') as HTMLElement
                        ;(document.getElementById('block-name-input') as HTMLInputElement).value = ''
                        document.getElementById('block-name-err')?.classList.remove('visible')
                        prompt.classList.add('visible')
                        ;(document.getElementById('block-name-input') as HTMLInputElement).focus()
                    }
                },
                (() => {
                    if (indexPath.includes('e' as unknown as number) || (step as { onError?: unknown }).onError !== undefined) return null
                    return { label: 'Add error handler', action: () => addErrorHandler(indexPath, step) }
                })(),
                (() => {
                    const blocks = getBlockNames(script.steps)
                    if (!blocks.length) return null
                    return {
                        label: 'Insert block reference', action: () => {
                            const items = blocks.map(name => ({
                                label: name,
                                action: () => insertStepAt(indexPath, { type: 'block-ref', name } as unknown as Step, 'after')
                            }))
                            contextMenu.show(e.clientX, e.clientY, items)
                        }
                    }
                })(),
                { isSep: true },
                { label: 'Delete', danger: true, action: () => deleteStep(indexPath) },
            ].filter(Boolean) as ContextMenuItem[])
        }
    })

    setupDragHandlers(row, indexPath)
    container.appendChild(row)
    if ((step as { onError?: Step[] }).onError !== undefined) {
        renderOnErrorGroup(step, indexPath, container)
    }
}

function renderGroupHeader(loop: LoopStep, i: number, indexPath: number[], container: HTMLElement, depth: number): void {
    const header = document.createElement('div')
    header.className = 'group-hdr'
    header.dataset.path = JSON.stringify(indexPath)
    header.dataset.t = 'loop'
    header.dataset.group = '1'

    header.innerHTML =
        '<div class="drag-handle">&#8286;</div>' +
        '<span class="step-num">' + stepLabel(indexPath) + '</span>' +
        '<span class="step-st"></span>' +
        '<button class="group-collapse" title="Collapse group">' + iconChevron + '</button>' +
        '<span class="chip loop">LOOP</span>' +
        '<span class="repeat-ctrl">&times;<input type="number" min="1" value="' + (loop.iterations ?? 1) + '" class="repeat-inp"></span>' +
        '<span class="group-summary">' + (loop.steps?.length ?? 0) + ' step(s)</span>' +
        '<div class="step-acts">' +
        '<button class="act" data-action="add-after" title="Add step after group">' + iconPlus + '</button>' +
        '<button class="act" data-action="ungroup" title="Ungroup">' + iconUngroup + '</button>' +
        '<button class="act del" data-action="delete" title="Delete group">' + iconTrash + '</button>' +
        '</div>'

    ;(header.querySelector('.repeat-inp') as HTMLInputElement).addEventListener('change', (e: Event) => {
        const iterations = parseInt((e.target as HTMLInputElement).value, 10)
        if (iterations >= 1) setNestedStep(indexPath, { ...loop, iterations } as unknown as Step)
    })

    ;(header.querySelector('.group-collapse') as HTMLButtonElement).addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation()
        const body = header.nextElementSibling as HTMLElement | null
        const button = header.querySelector('.group-collapse') as HTMLElement
        const hidden = body?.style.display === 'none'
        if (body) body.style.display = hidden ? '' : 'none'
        button.classList.toggle('collapsed', !hidden)
        const pathKey = header.dataset.path!
        if (hidden) { collapsedSet.delete(pathKey) } else { collapsedSet.add(pathKey) }
    })

    header.addEventListener('click', (e: MouseEvent) => {
        if ((e.target as HTMLElement).closest('.drag-handle, .group-collapse, .repeat-inp')) return
        const actionElement = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null
        const action = actionElement?.dataset.action
        if (action === 'delete') { deleteStep(indexPath); return }
        if (action === 'add-after') { showStepPicker(header, indexPath, 'after'); return }
        if (action === 'ungroup') { ungroupLoop(indexPath); return }
    })

    header.addEventListener('contextmenu', (e: MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        contextMenu.show(e.clientX, e.clientY, [
            { label: 'Edit iterations', action: () => stepEditorPopup.open(loop as unknown as Step, header, indexPath, e) },
            { isSep: true },
            {
                label: 'Add step inside', action: () => {
                    showStepPicker(header, [...indexPath, Math.max(0, (loop.steps ?? []).length - 1)], 'after')
                }
            },
            { label: 'Ungroup', action: () => ungroupLoop(indexPath) },
            { isSep: true },
            { label: 'Delete loop + contents', danger: true, action: () => deleteStep(indexPath) },
        ])
    })

    header.addEventListener('dragover', (e: DragEvent) => {
        if (!dragSourcePath) return
        e.preventDefault()
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
        setStepDragOver(null)
        header.classList.add('loop-drop-target')
    })

    header.addEventListener('dragleave', () => { header.classList.remove('loop-drop-target') })

    header.addEventListener('drop', (e: DragEvent) => {
        e.preventDefault()
        header.classList.remove('loop-drop-target')
        if (!dragSourcePath) return

        const isMulti = e.dataTransfer?.getData('multi') === 'true'
        const pathsToMove = isMulti ? getSelectedPaths() : [dragSourcePath]

        const stepsToAdd = pathsToMove.map(path => JSON.parse(JSON.stringify(getStepAt(path).arr[getStepAt(path).idx])) as Step)

        pathsToMove.slice().reverse().forEach(path => {
            const ref = getStepAt(path)
            ref.arr.splice(ref.idx as number, 1)
        })

        const loopRef = getStepAt(indexPath)
        const loopStep = loopRef.arr[loopRef.idx] as LoopStep
        if (!loopStep.steps) loopStep.steps = []
        stepsToAdd.forEach(step => loopStep.steps!.push(step))

        dragSourcePath = null
        renderStepList()
        updateToolbarState()
    })

    container.appendChild(header)

    const body = document.createElement('div')
    body.className = 'group-body'
    renderSteps(loop.steps ?? [], body, indexPath)
    container.appendChild(body)
}

function renderBlockHeader(block: BlockDefinitionStep, i: number, indexPath: number[], container: HTMLElement, depth: number): void {
    const header = document.createElement('div')
    header.className = 'block-hdr'
    header.dataset.path = JSON.stringify(indexPath)
    header.dataset.t = 'block'
    header.dataset.group = 'block'

    const stepNumberClass = depth > 0 ? 'step-num sub' : 'step-num'

    header.innerHTML =
        '<div class="drag-handle">&#8286;</div>' +
        '<span class="' + stepNumberClass + '">' + stepLabel(indexPath) + '</span>' +
        '<span class="step-st"></span>' +
        '<button class="group-collapse" title="Collapse block">' + iconChevron + '</button>' +
        '<span class="chip block-chip">BLOCK</span>' +
        '<span class="block-name">' + escapeHtml(block.name ?? '') + '</span>' +
        '<span class="group-summary">' + (block.steps ? block.steps.length : 0) + ' step(s)</span>' +
        '<div class="step-acts">' +
        '<button class="act" data-action="add-inside" title="Add step inside">' + iconPlus + '</button>' +
        '<button class="act del" data-action="delete" title="Delete block">' + iconTrash + '</button>' +
        '</div>'

    ;(header.querySelector('.group-collapse') as HTMLButtonElement).addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation()
        const body = header.nextElementSibling as HTMLElement | null
        const button = header.querySelector('.group-collapse') as HTMLElement
        const hidden = body?.style.display === 'none'
        if (body) body.style.display = hidden ? '' : 'none'
        button.classList.toggle('collapsed', !hidden)
        const pathKey = header.dataset.path!
        if (hidden) { collapsedSet.delete(pathKey) } else { collapsedSet.add(pathKey) }
    })

    header.addEventListener('click', (e: MouseEvent) => {
        if ((e.target as HTMLElement).closest('.drag-handle, .group-collapse')) return
        const actionElement = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null
        const action = actionElement?.dataset.action
        if (action === 'delete') {
            if (confirm('Delete block "' + block.name + '" and all references?')) {
                deleteBlockWithRefs(block.name, indexPath)
            }
            return
        }
        if (action === 'add-inside') {
            const insidePath = [...indexPath, block.steps ? block.steps.length : 0]
            showStepPicker(header, insidePath, 'append')
            return
        }
    })

    header.addEventListener('contextmenu', (e: MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        const blockResult = getStepAt(indexPath)
        const blockStep = blockResult.arr[blockResult.idx] as { name: string; steps: Step[] }
        contextMenu.show(e.clientX, e.clientY, [
            {
                label: 'Rename block...', action: () => {
                    const newName = prompt('Rename block "' + blockStep.name + '":', blockStep.name)
                    if (newName && newName.trim() && newName.trim() !== blockStep.name) {
                        let taken = false
                        const scan = (steps: Step[]): void => {
                            steps.forEach(step => {
                                if (step.type === 'block' && (step as { name: string }).name === newName.trim()) taken = true
                                if ((step as LoopStep).steps) scan((step as LoopStep).steps!)
                            })
                        }
                        scan(script.steps)
                        if (taken) { alert('A block named "' + newName.trim() + '" already exists.'); return }
                        renameBlock(indexPath, newName.trim())
                    }
                }
            },
            { isSep: true },
            {
                label: 'Add step inside', action: () => {
                    const insidePath = [...indexPath, blockStep.steps ? blockStep.steps.length : 0]
                    showStepPicker(header, insidePath, 'append')
                }
            },
            { label: 'Dissolve block', action: () => dissolveBlock(indexPath) },
            { isSep: true },
            {
                label: 'Delete block + all references', danger: true, action: () => {
                    const refs = findAllBlockRefs(script.steps, blockStep.name, []).length
                    let msg = 'Delete block "' + blockStep.name + '" and its ' + blockStep.steps.length + ' step(s)?'
                    if (refs > 0) msg += ' This will also remove ' + refs + ' reference(s).'
                    if (confirm(msg)) deleteBlockWithRefs(blockStep.name, indexPath)
                }
            }
        ])
    })

    setupDragHandlers(header, indexPath)
    container.appendChild(header)

    const body = document.createElement('div')
    body.className = 'block-body group-body'
    renderSteps(block.steps ?? [], body, indexPath)
    container.appendChild(body)
    if ((block as unknown as { onError?: Step[] }).onError !== undefined) {
        renderOnErrorGroup(block as unknown as Step, indexPath, container)
    }
}

function renderBlockRefRow(step: Step, i: number, indexPath: number[], container: HTMLElement, depth: number): void {
    const row = document.createElement('div')
    row.className = 'block-ref-row'
    row.dataset.path = JSON.stringify(indexPath)
    row.dataset.t = 'block-ref'

    const stepNumberClass = depth > 0 ? 'step-num sub' : 'step-num'
    const isDisabled = (step as { disabled?: boolean }).disabled

    row.innerHTML =
        '<div class="drag-handle">&#8286;</div>' +
        '<span class="' + stepNumberClass + '">' + stepLabel(indexPath) + '</span>' +
        '<span class="step-st"></span>' +
        '<input type="checkbox" class="step-cb"' + (isDisabled ? '' : ' checked') + '>' +
        '<span class="chip block-chip">BLOCK</span>' +
        '<span class="block-ref-name">' + escapeHtml((step as { name?: string }).name ?? '') + '</span>' +
        '<span class="ref-badge">REF</span>' +
        '<div class="step-acts">' +
        '<button class="act" data-action="add-before" title="Add step before">' + iconAddBefore + '</button>' +
        '<button class="act" data-action="add-after" title="Add step after">' + iconAddAfter + '</button>' +
        '<button class="act del" data-action="delete" title="Delete reference">' + iconTrash + '</button>' +
        '</div>'

    row.addEventListener('click', (e: MouseEvent) => {
        if ((e.target as HTMLElement).closest('.drag-handle')) return
        if ((e.target as HTMLElement).classList.contains('step-cb')) {
            const ref = getStepAt(indexPath)
            ;(ref.arr[ref.idx] as { disabled?: boolean }).disabled = !(e.target as HTMLInputElement).checked
            row.classList.toggle('disabled', !!(ref.arr[ref.idx] as { disabled?: boolean }).disabled)
            markDirty()
            return
        }
        const actionElement = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null
        const action = actionElement?.dataset.action
        if (action === 'delete') { deleteStep(indexPath); return }
        if (action === 'add-before') { showStepPicker(row, indexPath, 'before'); return }
        if (action === 'add-after') { showStepPicker(row, indexPath, 'after'); return }
        applyStepSelection(e, indexPath)
    })

    if (isDisabled) row.classList.add('disabled')
    setupDragHandlers(row, indexPath)

    row.addEventListener('contextmenu', (e: MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        const refResult = getStepAt(indexPath)
        const refStep = refResult.arr[refResult.idx] as { name: string }
        contextMenu.show(e.clientX, e.clientY, [
            { label: 'Jump to definition', action: () => jumpToDefinition(refStep.name) },
            { isSep: true },
            { label: 'Delete reference', danger: true, action: () => deleteStep(indexPath) }
        ])
    })

    container.appendChild(row)
}

/** Re-applies the 'selected' class to every step row from the current selection set. */
function refreshStepRowSelectionClasses(): void {
    document.querySelectorAll('.step-row').forEach(row => {
        const raw = (row as HTMLElement).dataset.path
        const path = raw ? JSON.parse(raw) as (number | string)[] : null
        if (path) row.classList.toggle('selected', isSelected(path))
    })
}

/**
 * Applies a click's selection semantics (shift = range, ctrl/meta = toggle, plain
 * = single-select) to the step at indexPath, then syncs the row highlight and the
 * selection bar. Shared by every step-row click path.
 */
function applyStepSelection(e: MouseEvent, indexPath: number[]): void {
    if (e.shiftKey && lastClickedPath) {
        const range = getPathsBetween(lastClickedPath, indexPath)
        range.forEach(path => selectedSet.add(JSON.stringify(path)))
        lastClickedPath = indexPath
    } else if (e.ctrlKey || e.metaKey) {
        if (isSelected(indexPath)) { deselectPath(indexPath) } else { selectPath(indexPath) }
    } else {
        selectedSet.clear()
        selectPath(indexPath)
    }
    refreshStepRowSelectionClasses()
    updateSelectionBar()
}

function jumpToDefinition(name: string): void {
    let found: Element | null = null
    document.querySelectorAll('[data-group="block"]').forEach(element => {
        try {
            const path = JSON.parse((element as HTMLElement).dataset.path!) as (number | string)[]
            const result = getStepAt(path)
            if (result.arr[result.idx] && (result.arr[result.idx] as { name?: string }).name === name) found = element
        } catch { /* ignore */ }
    })
    if (!found) return
    ;(found as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    ;(found as HTMLElement).classList.remove('block-flash')
    void (found as HTMLElement).offsetWidth
    ;(found as HTMLElement).classList.add('block-flash')
    ;(found as HTMLElement).addEventListener('animationend', () => (found as HTMLElement).classList.remove('block-flash'), { once: true })
}

function renderOnErrorGroup(step: Step, parentPath: (number | string)[], container: HTMLElement): void {
    const stepData = step as { onError?: Step[] }
    if (!stepData.onError) return

    const onErrorPath = [...parentPath, 'e']

    const header = document.createElement('div')
    header.className = 'on-error-hdr'
    header.dataset.path = JSON.stringify(parentPath)
    header.dataset.onErrorHdr = '1'

    header.innerHTML =
        '<div style="width:14px;flex-shrink:0"></div>' +
        '<div style="width:22px;flex-shrink:0"></div>' +
        '<button class="group-collapse" title="Collapse error handler">' + iconChevron + '</button>' +
        '<span class="chip on-error-chip">ON ERROR</span>' +
        '<span class="on-error-label">' + (stepData.onError.length ?? 0) + ' step(s)</span>' +
        '<div class="step-acts">' +
        '<button class="act" data-action="add-inside" title="Add step inside error handler">' + iconPlus + '</button>' +
        '<button class="act del" data-action="remove" title="Remove error handler">' + iconTrash + '</button>' +
        '</div>'

    ;(header.querySelector('.group-collapse') as HTMLButtonElement).addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation()
        const body = header.nextElementSibling as HTMLElement | null
        const button = header.querySelector('.group-collapse') as HTMLElement
        const hidden = body?.style.display === 'none'
        if (body) body.style.display = hidden ? '' : 'none'
        button.classList.toggle('collapsed', !hidden)
    })

    header.addEventListener('click', (e: MouseEvent) => {
        if ((e.target as HTMLElement).closest('.group-collapse')) return
        const actionElement = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null
        const action = actionElement?.dataset.action
        if (action === 'add-inside') {
            const insidePath = [...onErrorPath, stepData.onError!.length]
            showStepPicker(header, insidePath, 'append')
            return
        }
        if (action === 'remove') {
            removeOnErrorHandler(parentPath)
            return
        }
    })

    header.addEventListener('contextmenu', (e: MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        const onErrorCount = stepData.onError ? stepData.onError.length : 0
        contextMenu.show(e.clientX, e.clientY, [
            {
                label: 'Add step inside error handler',
                action: () => showStepPicker(header, [...parentPath, 'e', onErrorCount], 'append')
            },
            { isSep: true },
            {
                label: 'Remove error handler' + (onErrorCount > 0 ? ' (' + onErrorCount + ' step(s))' : ''),
                danger: true,
                action: () => removeOnErrorHandler(parentPath)
            }
        ])
    })

    container.appendChild(header)

    const body = document.createElement('div')
    body.className = 'on-error-body group-body'
    renderSteps(stepData.onError ?? [], body, onErrorPath as number[])
    container.appendChild(body)
}

function removeOnErrorHandler(stepPath: (number | string)[]): void {
    const result = getStepAt(stepPath)
    const arr = result.arr
    const idx = result.idx
    const stepData = arr[idx] as { onError?: Step[] }
    if (!stepData || !stepData.onError) return
    const count = stepData.onError.length
    if (count > 0 && !confirm('Remove error handler and its ' + count + ' step(s)?')) return
    const updated = { ...arr[idx] } as Step
    delete (updated as { onError?: Step[] }).onError
    arr[idx] = updated
    renderStepList()
    updateToolbarState()
}

// --- Drag and drop ---

/**
 * Sets the drop indicator on a single step row (or clears it with null), moving the
 * 'drag-over' class off the previously-indicated row. Avoids a full-DOM
 * querySelectorAll('.drag-over') on every dragover event (which fires per mouse move).
 */
function setStepDragOver(element: HTMLElement | null): void {
    if (dragOverElement && dragOverElement !== element) dragOverElement.classList.remove('drag-over')
    if (element) element.classList.add('drag-over')
    dragOverElement = element
}

function setupDragHandlers(row: HTMLElement, path: number[]): void {
    const handle = row.querySelector('.drag-handle') as HTMLElement | null
    if (handle) {
        handle.addEventListener('mousedown', () => {
            if (!isPlaying) row.draggable = true
        })
        row.addEventListener('dragend', () => {
            row.draggable = false
            dragSourcePath = null
            setStepDragOver(null)
            document.querySelectorAll('.loop-drop-target').forEach(row => row.classList.remove('loop-drop-target'))
        })
        row.addEventListener('mouseleave', () => {
            if (!dragSourcePath) row.draggable = false
        })
    }
    row.draggable = false

    row.addEventListener('dragstart', (e: DragEvent) => {
        if (!row.draggable) { e.preventDefault(); return }
        dragSourcePath = path
        if (isSelected(path)) {
            e.dataTransfer?.setData('multi', 'true')
        }
        row.classList.add('dragging')
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
    })

    row.addEventListener('dragover', (e: DragEvent) => {
        e.preventDefault()
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
        setStepDragOver(row)
    })

    row.addEventListener('drop', (e: DragEvent) => {
        e.preventDefault()
        setStepDragOver(null)
        if (!dragSourcePath) return
        const targetPath = path

        if (e.dataTransfer?.getData('multi') === 'true') {
            const selectedPaths = getSelectedPaths()
            if (selectedPaths.some(selectedPath => JSON.stringify(selectedPath) === JSON.stringify(targetPath))) return
            moveStepsToBefore(selectedPaths, targetPath)
        } else {
            if (JSON.stringify(dragSourcePath) === JSON.stringify(targetPath)) return
            const src = getStepAt(dragSourcePath)
            const step = JSON.parse(JSON.stringify(src.arr[src.idx])) as Step
            src.arr.splice(src.idx as number, 1)
            const dst = getStepAt(targetPath)
            dst.arr.splice(dst.idx as number, 0, step)
            renderStepList()
            updateToolbarState()
        }
        dragSourcePath = null
    })
}

// --- Step picker ---

interface StepPickerType {
    type: string
    label: string
    desc: string
    defaultStep: Partial<Step>
}

const ALL_STEP_TYPES: StepPickerType[] = [
    { type: 'press', label: 'PRESS', desc: 'Send a remote key press', defaultStep: { type: 'press', key: 'Home' } as unknown as Step },
    { type: 'text', label: 'TEXT', desc: 'Send a text string', defaultStep: { type: 'text', value: '' } as unknown as Step },
    { type: 'delay', label: 'PAUSE', desc: 'Wait a fixed duration', defaultStep: { type: 'delay', durationMs: 1000 } as unknown as Step },
    { type: 'screenshot', label: 'SCREEN', desc: 'Cert screenshot marker', defaultStep: { type: 'screenshot', marker: '' } as unknown as Step },
    { type: 'launch', label: 'LAUNCH', desc: 'Launch a channel', defaultStep: { type: 'launch', channelId: '' } as unknown as Step },
    { type: 'loop', label: 'LOOP', desc: 'Repeat a sequence of steps', defaultStep: { type: 'loop', iterations: 1, steps: [] } as unknown as Step },
    { type: 'waitPlayerState', label: 'PLAYER', desc: 'Wait for a media player state', defaultStep: { type: 'waitPlayerState', state: 'play' } as unknown as Step },
    { type: 'validateStreaming', label: 'VALIDATE', desc: 'Assert audio/video codec', defaultStep: { type: 'validateStreaming' } as unknown as Step },
    { type: 'channelTileOrder', label: 'TILES', desc: 'Assert home screen channel order', defaultStep: { type: 'channelTileOrder', channels: [] } as unknown as Step },
    { type: 'comment', label: 'COMMENT', desc: 'Add a comment (# in RASP)', defaultStep: { type: 'comment', text: '' } as unknown as Step },
]

function showStepPicker(anchorEl: HTMLElement, insertPath: (number | string)[] | null, position: string): void {
    const existing = document.querySelector('.picker-overlay')
    if (existing) existing.remove()

    const overlay = document.createElement('div')
    overlay.className = 'picker-overlay'

    const menu = document.createElement('div')
    menu.className = 'picker-menu'

    const header = document.createElement('div')
    header.className = 'picker-menu-hdr'
    header.textContent = 'Add step'
    menu.appendChild(header)

    for (const stepType of ALL_STEP_TYPES) {
        const item = document.createElement('div')
        item.className = 'picker-item'
        item.innerHTML = '<span class="chip ' + chipKey(stepType.type) + '">' + stepType.label + '</span><span class="picker-item-desc">' + stepType.desc + '</span>'
        item.addEventListener('click', () => {
            overlay.remove()
            const step = { ...stepType.defaultStep } as Step
            if (insertPath) {
                insertStepAt(insertPath, step, position)
            } else {
                appendStep(step)
            }
        })
        menu.appendChild(item)
    }

    const blocks = getBlockNames(script.steps)

    const sep = document.createElement('div')
    sep.style.cssText = 'height:1px;background:var(--rokdock-border);margin:4px 0'
    menu.appendChild(sep)

    const refItem = document.createElement('div')
    refItem.className = 'picker-item' + (blocks.length ? '' : ' disabled')
    refItem.innerHTML = '<span class="chip block-chip">BLOCK</span>' +
        '<span class="picker-item-desc">' + (blocks.length ? 'Insert block reference' : 'Insert block reference (no blocks)') + '</span>'

    if (blocks.length) {
        refItem.addEventListener('click', () => {
            overlay.remove()
            if (blocks.length === 1) {
                const step = { type: 'block-ref', name: blocks[0] } as unknown as Step
                if (insertPath) { insertStepAt(insertPath, step, position) } else { appendStep(step) }
            } else {
                const subOverlay = document.createElement('div')
                subOverlay.className = 'picker-overlay'
                const subMenu = document.createElement('div')
                subMenu.className = 'picker-menu'
                subMenu.style.top = menu.style.top
                subMenu.style.left = menu.style.left
                const subHeader = document.createElement('div')
                subHeader.className = 'picker-menu-hdr'
                subHeader.textContent = 'Choose block'
                subMenu.appendChild(subHeader)
                blocks.forEach(name => {
                    const blockItem = document.createElement('div')
                    blockItem.className = 'picker-item'
                    blockItem.innerHTML = '<span class="chip block-chip" style="width:76px;text-align:center;justify-content:center;font-size:var(--rokdock-font-sm)">BLOCK</span><span class="picker-item-desc">' + escapeHtml(name) + '</span>'
                    blockItem.addEventListener('click', () => {
                        subOverlay.remove()
                        const step = { type: 'block-ref', name } as unknown as Step
                        if (insertPath) { insertStepAt(insertPath, step, position) } else { appendStep(step) }
                    })
                    subMenu.appendChild(blockItem)
                })
                subOverlay.addEventListener('click', (ev: MouseEvent) => { if (ev.target === subOverlay) subOverlay.remove() })
                subOverlay.appendChild(subMenu)
                document.body.appendChild(subOverlay)
            }
        })
    }
    menu.appendChild(refItem)

    overlay.addEventListener('click', (e: MouseEvent) => { if (e.target === overlay) overlay.remove() })
    overlay.appendChild(menu)
    document.body.appendChild(overlay)

    const rect = anchorEl.getBoundingClientRect()
    const menuWidth = 230
    const menuHeight = (menu as HTMLElement).offsetHeight || 320
    const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8))
    let top = rect.bottom + 4
    if (top + menuHeight > window.innerHeight - 8) top = Math.max(8, rect.top - menuHeight - 4)
    menu.style.top = top + 'px'
    menu.style.left = left + 'px'
}

// --- Library ---

async function renderLibrary(): Promise<void> {
    const result = await window.rokdock.scriptEditor.list()
    const list = document.getElementById('library-list') as HTMLElement
    list.innerHTML = ''
    if (!result.ok || !result.scripts?.length) {
        libraryScripts = []
        list.innerHTML = '<div style="padding:var(--rokdock-space-sm);font-size:var(--rokdock-font-sm);color:var(--rokdock-text-muted)">No saved scripts</div>'
        return
    }
    libraryScripts = result.scripts
    let dragSourceIndex: number | null = null
    result.scripts.forEach((scriptEntry: { name: string; filePath: string; modifiedAt: number; stepCount: number }, scriptIndex: number) => {
        const item = document.createElement('div')
        item.className = 'lib-item'
        item.dataset.idx = String(scriptIndex)
        item.draggable = true
        item.innerHTML =
            '<div class="lib-drag-handle">&#8286;</div>' +
            '<div class="lib-meta">' +
            '<div class="lib-name" title="' + escapeHtml(scriptEntry.name) + '">' + escapeHtml(scriptEntry.name) + '</div>' +
            '<div class="lib-detail">' + (scriptEntry.stepCount ?? 0) + ' steps</div>' +
            '</div>' +
            '<button class="act del lib-del" title="Delete script">' + iconTrash + '</button>'

        ;(item.querySelector('.lib-meta') as HTMLElement).addEventListener('click', () => void loadScript(scriptEntry.filePath))
        ;(item.querySelector('.lib-del') as HTMLButtonElement).addEventListener('click', async (e: MouseEvent) => {
            e.stopPropagation()
            const ok = await showInlineConfirm('Delete "' + scriptEntry.name + '"?', 'Delete')
            if (!ok) return
            await window.rokdock.scriptEditor.delete(scriptEntry.filePath)
            if (savedFilePath === scriptEntry.filePath) savedFilePath = null
            void renderLibrary()
        })

        item.addEventListener('dragstart', function (this: HTMLElement, e: DragEvent) {
            dragSourceIndex = parseInt(this.dataset.idx!, 10)
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
        })
        item.addEventListener('dragover', function (this: HTMLElement, e: DragEvent) {
            e.preventDefault()
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
            const rect = this.getBoundingClientRect()
            const half = e.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom'
            this.style.borderTop = half === 'top' ? '2px solid var(--rokdock-brand-primary)' : ''
            this.style.borderBottom = half === 'bottom' ? '2px solid var(--rokdock-brand-primary)' : ''
        })
        item.addEventListener('dragleave', function (this: HTMLElement) {
            this.style.borderTop = ''
            this.style.borderBottom = ''
        })
        item.addEventListener('drop', function (this: HTMLElement, e: DragEvent) {
            e.preventDefault()
            this.style.borderTop = ''
            this.style.borderBottom = ''
            const toIdx = parseInt(this.dataset.idx!, 10)
            if (dragSourceIndex == null || dragSourceIndex === toIdx) return
            const rect = this.getBoundingClientRect()
            const half = e.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom'
            const reordered = libraryScripts.slice()
            const moved = reordered.splice(dragSourceIndex, 1)[0]
            let insertAt = half === 'top' ? toIdx : toIdx + 1
            if (dragSourceIndex < toIdx) insertAt--
            reordered.splice(insertAt, 0, moved)
            libraryScripts = reordered
            void window.rokdock.scriptEditor.saveSortOrder(reordered.map(x => x.filePath))
        })
        item.addEventListener('dragend', function (this: HTMLElement) {
            this.style.borderTop = ''
            this.style.borderBottom = ''
            dragSourceIndex = null
        })
        list.appendChild(item)
    })
}

async function loadScript(filePath: string): Promise<void> {
    if (script.steps.length > 0 && (isDirty || savedFilePath !== filePath)) {
        const confirmed = await showInlineConfirm('Load this script? Unsaved changes will be lost.', 'Replace')
        if (!confirmed) return
    }
    const result = await window.rokdock.scriptEditor.load(filePath)
    if (!result.ok || !result.script) return
    script = result.script
    migrateSteps(script.steps)
    savedFilePath = filePath
    clearDirty()
    updateScriptName()
    renderStepList()
    updateToolbarState()
}

// --- Variables ---

function scanTokens(): string[] {
    const extractFn = window.rokdock?.scriptEditor?.extractTokens
    return extractFn ? extractFn(script.steps) : []
}

function renderVariables(): void {
    const container = document.getElementById('variables-list') as HTMLElement
    container.innerHTML = ''
    if (!script.metadata) script.metadata = {}
    if (!script.metadata.variables) script.metadata.variables = {}
    const vars = script.metadata.variables as Record<string, string>
    const names = Object.keys(vars)

    if (names.length === 0) {
        container.innerHTML = '<div style="font-size:var(--rokdock-font-sm);color:var(--rokdock-text-muted);padding:var(--rokdock-space-xs) 0;font-style:italic">No variables defined</div>'
    } else {
        for (const name of names) {
            renderVariableRow(container, name, vars)
        }
    }

    const section = document.getElementById('variables-section')
    let badge = section ? section.querySelector('[slot="badge"]') as HTMLElement | null : null
    if (names.length > 0) {
        if (!badge) {
            badge = document.createElement('span')
            badge.slot = 'badge'
            badge.className = 'list-badge'
            section?.appendChild(badge)
        }
        badge.textContent = String(names.length)
    } else if (badge) {
        badge.remove()
    }
}

function renderVariableRow(container: HTMLElement, name: string, vars: Record<string, string>): void {
    const row = document.createElement('div')
    row.style.cssText = 'display:flex;align-items:center;gap:var(--rokdock-space-xs);margin-bottom:3px'

    const label = document.createElement('span')
    label.className = 'ed-lbl'
    label.style.cssText = 'min-width:60px;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0;'
    label.textContent = name
    label.title = name

    const input = document.createElement('input')
    input.className = 'ed-inp'
    input.type = 'text'
    input.value = vars[name] ?? ''
    input.placeholder = 'Value'
    input.style.cssText = 'flex:1;min-width:0;height:18px;font-size:var(--rokdock-font-sm);padding:0 var(--rokdock-space-xs);font-family:var(--rokdock-font-ui);'
    input.addEventListener('change', () => { vars[name] = input.value })

    const deleteButton = document.createElement('button')
    deleteButton.className = 'act del'
    deleteButton.title = 'Delete variable'
    deleteButton.innerHTML = iconX
    deleteButton.addEventListener('click', () => {
        const tokens = scanTokens()
        const refCount = tokens.filter(token => token === name).length
        if (refCount > 0) {
            if (!window.confirm('Variable ' + name + ' is used in ' + refCount + ' step(s). Delete anyway?')) return
        }
        delete vars[name]
        renderVariables()
    })

    row.appendChild(label)
    row.appendChild(input)
    row.appendChild(deleteButton)
    container.appendChild(row)
}

function syncScannedVariables(): void {
    if (!script.metadata) script.metadata = {}
    if (!script.metadata.variables) script.metadata.variables = {}
    const vars = script.metadata.variables as Record<string, string>
    const tokens = scanTokens()
    let changed = false
    for (const token of tokens) {
        if (!(token in vars)) {
            vars[token] = ''
            changed = true
        }
    }
    if (changed) renderVariables()
}

// --- Save ---

async function saveScript(): Promise<void> {
    if (!script.name || script.name === '(untitled)') {
        const name = await showInlinePrompt('Script name:', '')
        if (!name) return
        script.name = name
        updateScriptName()
    } else if (savedFilePath) {
        const choice = await showSaveChoiceDialog(script.name)
        if (!choice) return
        if (choice === 'new') {
            const newName = await showInlinePrompt('New script name:', '')
            if (!newName) return
            script.name = newName
            updateScriptName()
        }
    }
    const result = await window.rokdock.scriptEditor.save(script)
    if (result.ok) {
        savedFilePath = result.filePath ?? null
        clearDirty()
        void renderLibrary()
    }
}

function showSaveChoiceDialog(name: string): Promise<string | null> {
    return new Promise(resolve => {
        const dialog = createDialog({ maxWidth: '280px', center: true })
        const msg = document.createElement('p')
        msg.style.cssText = 'font-size:var(--rokdock-font-base);line-height:1.4;margin-bottom:0'
        msg.textContent = 'Overwrite "' + name + '" or save as a new script?'
        dialog.body.appendChild(msg)
        const done = (choice: string | null): void => { dialog.close(); resolve(choice) }
        addDialogButton(dialog.buttonRow, 'Overwrite', 'rokdock-btn-danger').addEventListener('click', () => done('overwrite'))
        addDialogButton(dialog.buttonRow, 'Save as new', 'rokdock-btn-primary').addEventListener('click', () => done('new'))
        addDialogButton(dialog.buttonRow, 'Cancel', 'rokdock-btn-ghost').addEventListener('click', () => done(null))
    })
}

// --- Playback ---

async function playScript(): Promise<void> {
    if (!selectedDeviceIp) {
        showLog()
        logFail('No device selected. Choose a device in the toolbar first.')
        return
    }
    const tokens = scanTokens()
    if (tokens.length > 0) {
        if (!script.metadata) script.metadata = {}
        if (!script.metadata.variables) script.metadata.variables = {}
        const vars = script.metadata.variables as Record<string, string>
        const missing = tokens.filter(token => !vars[token])
        if (missing.length > 0) {
            showLog()
            logFail('Missing variable values: ' + missing.map(token => '${' + token + '}').join(', '))
            const section = document.getElementById('variables-section')
            if (section && !section.hasAttribute('open')) section.setAttribute('open', '')
            return
        }
    }
    isPlaying = true
    clearLog()
    showLog()
    updateToolbarState()
    logInfo('Starting playback...')
    await window.rokdock.scriptEditor.play(script, selectedDeviceIp)
}

async function stopPlayback(): Promise<void> {
    await window.rokdock.scriptEditor.stopPlayback()
}

function handleEngineEvent(ev: EngineEvent): void {
    switch (ev.type) {
        case 'step-start':
            updateStepStatus(ev.label ?? '', 'running')
            logRun('Running step ' + ev.label + '...')
            break
        case 'step-complete':
            updateStepStatus(ev.label ?? '', 'done')
            logInfo('Step ' + ev.label + ' complete')
            break
        case 'step-failed':
            updateStepStatus(ev.label ?? '', 'failed')
            logFail('Step ' + ev.label + ' failed: ' + ev.error)
            break
        case 'step-skipped':
            updateStepStatus(ev.label ?? '', 'skipped')
            logInfo('Step ' + ev.label + ' skipped')
            break
        case 'engine-complete':
            isPlaying = false
            updateToolbarState()
            logInfo('Playback complete')
            break
        case 'engine-failed':
            isPlaying = false
            updateToolbarState()
            logFail('Playback failed: ' + ev.error)
            break
        case 'engine-stopped':
            isPlaying = false
            updateToolbarState()
            logInfo('Playback stopped')
            break
    }
}

function setStatus(msg?: string, busy?: boolean): void {
    const element = document.getElementById('sb-status') as HTMLElement
    if (busy) {
        element.innerHTML = '<span class="sb-spinner"></span>' + (msg ?? '')
        element.classList.add('active')
    } else {
        element.textContent = msg ?? 'Ready'
        element.classList.remove('active')
    }
}

function updateStepStatus(label: string, status: string): void {
    const rows = document.querySelectorAll('[data-path]')
    for (const row of rows) {
        const path = JSON.parse((row as HTMLElement).dataset.path ?? '[]') as number[]
        if (stepLabel(path) === label) {
            row.classList.remove('s-run', 's-done', 's-fail')
            if (status === 'running') row.classList.add('s-run')
            if (status === 'done') row.classList.add('s-done')
            if (status === 'failed') row.classList.add('s-fail')
            const icon = row.querySelector('[data-status]') as HTMLElement | null
            if (icon) {
                if (status === 'running') { icon.innerHTML = iconSpin; icon.style.color = 'var(--run)'; icon.classList.add('spinning') }
                else if (status === 'done') { icon.innerHTML = iconCheck; icon.style.color = 'var(--ok)'; icon.classList.remove('spinning') }
                else if (status === 'failed') { icon.innerHTML = iconFail; icon.style.color = 'var(--fail)'; icon.classList.remove('spinning') }
                else { icon.innerHTML = ''; icon.style.color = ''; icon.classList.remove('spinning') }
            }
        }
    }
}

// --- Log ---

function showLog(): void { document.getElementById('log-panel')?.classList.add('active') }
function clearLog(): void {
    const entries = document.getElementById('log-entries')
    if (entries) entries.innerHTML = ''
}

function logEntry(className: string, msg: string): void {
    const element = document.createElement('div')
    element.className = 'log-row ' + className
    const now = new Date()
    const ts = now.getMinutes().toString().padStart(2, '0') + ':' + now.getSeconds().toString().padStart(2, '0')
    element.innerHTML = '<span class="log-t">' + escapeHtml(ts) + '</span><span class="log-m">' + escapeHtml(msg) + '</span>'
    const log = document.getElementById('log-entries') as HTMLElement
    log.appendChild(element)
    log.scrollTop = log.scrollHeight
}

function logFail(message: string): void { logEntry('fail', message) }
function logRun(message: string): void { logEntry('run', message) }
function logInfo(message: string): void { logEntry('ok', message) }

// --- Recording ---

function startRecording(): void {
    isRecording = true
    lastKeyTime = 0
    pendingHold = null
    recElapsedSecs = 0
    recStepCount = script.steps.length

    const idleGroup = document.getElementById('idleGroup') as HTMLElement
    const recordingGroup = document.getElementById('recGroup') as HTMLElement
    idleGroup.style.display = 'none'
    recordingGroup.style.display = 'flex'
    document.getElementById('record-btn')?.classList.add('recording')
    document.getElementById('remote-component')?.removeAttribute('disabled')

    const timerElement = document.getElementById('rec-timer')
    const countElement = document.getElementById('rec-step-count')
    if (timerElement) timerElement.textContent = '0:00'
    if (countElement) countElement.textContent = '0 steps'

    recTimerInterval = setInterval(() => {
        recElapsedSecs++
        const minutes = Math.floor(recElapsedSecs / 60)
        const seconds = String(recElapsedSecs % 60).padStart(2, '0')
        if (timerElement) timerElement.textContent = minutes + ':' + seconds
    }, 1000)
}

function stopRecording(): void {
    isRecording = false
    pendingHold = null
    if (recTimerInterval) clearInterval(recTimerInterval)
    recTimerInterval = null

    const recordingGroup = document.getElementById('recGroup') as HTMLElement
    const idleGroup = document.getElementById('idleGroup') as HTMLElement
    recordingGroup.style.display = 'none'
    idleGroup.style.display = 'contents'
    document.getElementById('record-btn')?.classList.remove('recording')
    document.getElementById('remote-component')?.setAttribute('disabled', '')
}

function addInterKeyDelay(): void {
    if (!recordDelays) return
    if (lastKeyTime > 0) {
        const elapsed = Date.now() - lastKeyTime
        if (elapsed >= DELAY_MIN_MS) {
            const clamped = Math.min(elapsed, DELAY_MAX_MS)
            const rounded = Math.round(clamped / DELAY_ROUND_MS) * DELAY_ROUND_MS
            appendStep({ type: 'delay', durationMs: rounded } as unknown as Step)
        }
    }
}

function recordKeyPress(key: string): void {
    addInterKeyDelay()
    lastKeyTime = Date.now()
    appendStep({ type: 'press', key } as unknown as Step)
}

function handleHotspotDown(key: string): void {
    if (isRecording) {
        addInterKeyDelay()
        pendingHold = { key, startTime: Date.now() }
    }
}

function handleHotspotUp(key: string): void {
    if (isRecording && pendingHold && pendingHold.key === key) {
        const holdDuration = Date.now() - pendingHold.startTime
        pendingHold = null
        suppressNextKeypress = true
        if (holdDuration < HOLD_THRESHOLD_MS) {
            appendStep({ type: 'press', key } as unknown as Step)
        } else {
            const rounded = Math.round(Math.min(holdDuration, DELAY_MAX_MS) / DELAY_ROUND_MS) * DELAY_ROUND_MS
            appendStep({ type: 'key_down', key } as unknown as Step)
            appendStep({ type: 'delay', durationMs: rounded } as unknown as Step)
            appendStep({ type: 'key_up', key } as unknown as Step)
        }
        lastKeyTime = Date.now()
    }
}

// --- Dialog factory ---

interface DialogResult {
    overlay: HTMLDivElement
    box: HTMLDivElement
    body: HTMLDivElement
    buttonRow: HTMLDivElement
    close: () => void
}

interface DialogOptions {
    maxWidth?: string
    width?: string
    center?: boolean
    header?: HTMLElement
    bodyStyle?: string
}

function createDialog(opts: DialogOptions): DialogResult {
    const overlay = document.createElement('div')
    overlay.className = 'rokdock-overlay'
    overlay.style.zIndex = '9999'
    const box = document.createElement('div')
    box.className = 'rokdock-dialog'
    if (opts.maxWidth) box.style.maxWidth = opts.maxWidth
    if (opts.width) box.style.width = opts.width
    if (opts.center) box.style.textAlign = 'center'
    if (opts.header) {
        const header = document.createElement('div')
        header.className = 'rokdock-dialog-header'
        header.appendChild(opts.header)
        box.appendChild(header)
    }
    const body = document.createElement('div')
    body.className = 'rokdock-dialog-body'
    if (opts.bodyStyle) body.style.cssText = opts.bodyStyle
    box.appendChild(body)
    const buttonRow = document.createElement('div')
    buttonRow.className = 'rokdock-dialog-actions'
    if (opts.center) buttonRow.style.justifyContent = 'center'
    box.appendChild(buttonRow)
    overlay.appendChild(box)
    document.body.appendChild(overlay)
    const close = (): void => { overlay.remove() }
    overlay.addEventListener('click', (e: MouseEvent) => { if (e.target === overlay) close() })
    // Swallow mousedown so the modal does not dismiss content behind it: the step
    // editor popup closes on any mousedown outside itself, and the channel picker
    // opens over it, so a pick must not register as an outside-click on the editor.
    overlay.addEventListener('mousedown', (e: MouseEvent) => e.stopPropagation())
    return { overlay, box, body, buttonRow, close }
}

function addDialogButton(buttonRow: HTMLElement, label: string, className?: string): HTMLButtonElement {
    const button = document.createElement('button')
    button.className = 'rokdock-btn' + (className ? ' ' + className : '')
    button.textContent = label
    buttonRow.appendChild(button)
    return button
}

function showInlineConfirm(message: string, confirmLabel?: string): Promise<boolean> {
    return new Promise(resolve => {
        const dialog = createDialog({ maxWidth: '280px', center: true })
        const msg = document.createElement('p')
        msg.style.cssText = 'font-size:var(--rokdock-font-base);line-height:1.4;margin-bottom:0;'
        msg.textContent = message
        dialog.body.appendChild(msg)
        const okButton = addDialogButton(dialog.buttonRow, confirmLabel ?? 'Confirm', 'rokdock-btn-danger')
        const cancelButton = addDialogButton(dialog.buttonRow, 'Cancel', 'rokdock-btn-ghost')
        okButton.addEventListener('click', () => { dialog.close(); resolve(true) })
        cancelButton.addEventListener('click', () => { dialog.close(); resolve(false) })
        dialog.overlay.addEventListener('click', (e: MouseEvent) => { if (e.target === dialog.overlay) { dialog.close(); resolve(false) } })
        cancelButton.focus()
    })
}

function showInlinePrompt(message: string, defaultValue: string): Promise<string | null> {
    return new Promise(resolve => {
        const dialog = createDialog({ maxWidth: '280px', width: '260px' })
        const msg = document.createElement('p')
        msg.style.cssText = 'font-size:var(--rokdock-font-base);margin-bottom:var(--rokdock-space-md);'
        msg.textContent = message
        const input = document.createElement('input')
        input.className = 'rokdock-input'
        input.value = defaultValue ?? ''
        input.style.cssText = 'width:100%;box-sizing:border-box;'
        dialog.body.appendChild(msg)
        dialog.body.appendChild(input)
        const commit = (): void => { dialog.close(); resolve(input.value.trim() || null) }
        const cancel = (): void => { dialog.close(); resolve(null) }
        addDialogButton(dialog.buttonRow, 'Cancel', 'rokdock-btn-ghost').addEventListener('click', cancel)
        addDialogButton(dialog.buttonRow, 'OK', 'rokdock-btn-primary').addEventListener('click', commit)
        input.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') { e.preventDefault(); commit() }
            if (e.key === 'Escape') { e.preventDefault(); cancel() }
        })
        input.focus()
        input.select()
    })
}

function showImportChoiceDialog(stepCount: number): Promise<string | null> {
    return new Promise(resolve => {
        const dialog = createDialog({ maxWidth: '300px', center: true })
        const msg = document.createElement('p')
        msg.style.cssText = 'font-size:var(--rokdock-font-base);line-height:1.4;'
        msg.textContent = 'Script has ' + stepCount + ' step' + (stepCount === 1 ? '' : 's') + '. Replace or append?'
        dialog.body.appendChild(msg)
        const done = (choice: string | null): void => { dialog.close(); resolve(choice) }
        addDialogButton(dialog.buttonRow, 'Replace', 'rokdock-btn-danger').addEventListener('click', () => done('replace'))
        const appendButton = addDialogButton(dialog.buttonRow, 'Append', 'rokdock-btn-primary')
        appendButton.addEventListener('click', () => done('append'))
        addDialogButton(dialog.buttonRow, 'Cancel', 'rokdock-btn-ghost').addEventListener('click', () => done(null))
        dialog.overlay.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Escape') done(null) })
        appendButton.focus()
    })
}

function showPasteRaspDialog(): Promise<string | null> {
    return new Promise(resolve => {
        const titleElement = document.createElement('span')
        titleElement.style.cssText = 'font-size:var(--rokdock-font-sm);font-weight:700;letter-spacing:.06em;text-transform:uppercase;'
        titleElement.textContent = 'Paste RASP script'
        const dialog = createDialog({ width: '480px', header: titleElement })
        const textarea = document.createElement('textarea')
        textarea.className = 'rokdock-input rokdock-input-mono'
        textarea.placeholder = 'Paste RASP script here...'
        textarea.style.cssText = 'width:100%;height:220px;resize:vertical;line-height:1.5;box-sizing:border-box;'
        dialog.body.appendChild(textarea)
        const commit = (): void => { dialog.close(); resolve(textarea.value.trim() || null) }
        const cancel = (): void => { dialog.close(); resolve(null) }
        addDialogButton(dialog.buttonRow, 'Cancel', 'rokdock-btn-ghost').addEventListener('click', cancel)
        addDialogButton(dialog.buttonRow, 'Import', 'rokdock-btn-primary').addEventListener('click', commit)
        textarea.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); cancel() } })
        textarea.focus()
    })
}

function showChannelPicker(deviceIp: string): Promise<{ id: string; name: string } | null> {
    return new Promise(resolve => {
        const dialog = createDialog({ width: '320px', bodyStyle: 'padding:0' })
        dialog.buttonRow.remove()
        const box = dialog.box
        const body = dialog.body

        const header = document.createElement('div')
        header.className = 'rokdock-dialog-header'
        const title = document.createElement('span')
        title.textContent = 'Installed Channels'
        title.style.cssText = 'font-size:var(--rokdock-font-base);font-weight:var(--rokdock-weight-semibold);flex:1'
        const closeButton = document.createElement('button')
        closeButton.className = 'act'
        closeButton.innerHTML = iconX
        closeButton.addEventListener('click', () => { dialog.close(); resolve(null) })

        const sortGroup = document.createElement('div')
        sortGroup.style.cssText = 'display:flex;gap:1px;margin-right:var(--rokdock-space-xs)'
        const sortButtonCss = 'font-size:var(--rokdock-font-sm);padding:2px var(--rokdock-space-sm);border:1px solid var(--rokdock-border);background:transparent;color:var(--rokdock-text-muted);cursor:pointer;border-radius:var(--rokdock-radius-sm);transition:all .1s'
        const sortActiveCss = 'background:var(--rokdock-brand-primary-faded);color:var(--rokdock-text-primary);border-color:var(--rokdock-brand-primary-light)'
        const sortName = document.createElement('button')
        sortName.innerHTML = iconSortAZ
        sortName.title = 'Sort by name'
        sortName.style.cssText = sortButtonCss
        const sortId = document.createElement('button')
        sortId.innerHTML = iconSortNum
        sortId.title = 'Sort by ID'
        sortId.style.cssText = sortButtonCss
        const setSortActive = (button: HTMLButtonElement): void => {
            sortName.style.cssText = sortButtonCss
            sortId.style.cssText = sortButtonCss
            button.style.cssText = sortButtonCss + ';' + sortActiveCss
        }
        sortGroup.appendChild(sortName)
        sortGroup.appendChild(sortId)
        header.appendChild(title)
        header.appendChild(sortGroup)
        header.appendChild(closeButton)
        box.insertBefore(header, body)

        const status = document.createElement('div')
        status.style.cssText = 'padding:var(--rokdock-space-md);font-size:var(--rokdock-font-sm);color:var(--rokdock-text-muted);text-align:center'
        status.textContent = 'Loading...'
        body.appendChild(status)
        // createDialog closes on backdrop click; also resolve(null) so the caller is settled.
        dialog.overlay.addEventListener('click', (e: MouseEvent) => { if (e.target === dialog.overlay) resolve(null) })

        const iconCache: Record<string, string> = {}

        const renderAppList = (apps: { id: string; name: string }[]): void => {
            const existing = body.querySelector('.ch-pick-list')
            if (existing) existing.remove()
            const list = document.createElement('div')
            list.className = 'ch-pick-list'
            const iconQueue: { img: HTMLImageElement; appId: string }[] = []
            for (const app of apps) {
                const item = document.createElement('div')
                item.className = 'ch-pick-item'
                const img = document.createElement('img')
                img.alt = ''
                if (iconCache[app.id]) {
                    img.src = iconCache[app.id]
                } else {
                    iconQueue.push({ img, appId: app.id })
                }
                const name = document.createElement('span')
                name.className = 'ch-pick-name'
                name.textContent = app.name
                const id = document.createElement('span')
                id.className = 'ch-pick-id'
                id.textContent = app.id
                item.appendChild(img)
                item.appendChild(name)
                item.appendChild(id)
                item.addEventListener('click', () => {
                    dialog.close()
                    resolve({ id: app.id, name: app.name })
                })
                list.appendChild(item)
            }
            body.appendChild(list)
            void (async () => {
                for (const { img, appId } of iconQueue) {
                    const iconResult = await window.rokdock.scriptEditor.queryAppIcon(deviceIp, appId)
                    if (iconResult.ok && iconResult.dataUri) { iconCache[appId] = iconResult.dataUri; img.src = iconResult.dataUri }
                }
            })()
        }

        void window.rokdock.scriptEditor.queryApps(deviceIp).then((result: { ok: boolean; apps?: { id: string; name: string }[]; error?: string }) => {
            body.removeChild(status)
            if (!result.ok) {
                status.textContent = 'Failed to query device: ' + (result.error ?? 'unknown error')
                status.style.color = 'var(--rokdock-state-error)'
                body.appendChild(status)
                return
            }
            if (!result.apps || result.apps.length === 0) {
                status.textContent = 'No channels installed'
                body.appendChild(status)
                return
            }
            const apps = result.apps
            renderAppList(apps)

            sortName.addEventListener('click', () => {
                setSortActive(sortName)
                apps.sort((appA: { id: string; name: string }, appB: { id: string; name: string }) => appA.name.localeCompare(appB.name))
                renderAppList(apps)
            })
            sortId.addEventListener('click', () => {
                setSortActive(sortId)
                apps.sort((appA: { id: string; name: string }, appB: { id: string; name: string }) => {
                    const idA = parseInt(appA.id, 10), idB = parseInt(appB.id, 10)
                    if (!isNaN(idA) && !isNaN(idB)) return idA - idB
                    return appA.id.localeCompare(appB.id)
                })
                renderAppList(apps)
            })
        })
    })
}

// --- RASP import ---

async function importRaspFromText(yamlText: string): Promise<void> {
    setStatus('Importing...', true)
    let result: { ok: boolean; script?: ScriptFile; warnings?: string[]; error?: string }
    try {
        result = await window.rokdock.scriptEditor.importRaspText(yamlText)
    } catch (e) {
        setStatus()
        showLog(); logFail('Import error: ' + String(e)); return
    }
    setStatus()
    if (!result.ok) {
        if ((result as { error?: string }).error) { showLog(); logFail('Import failed: ' + (result as { error: string }).error) }
        return
    }
    if (!result.script) { showLog(); logFail('Import returned no script'); return }

    let mode: string | null = 'replace'
    if (script.steps.length > 0) {
        mode = await showImportChoiceDialog(script.steps.length)
        if (!mode) return
    }

    if (mode === 'append') {
        script.steps = script.steps.concat(result.script.steps)
    } else {
        const prevName = script.name
        script = result.script
        script.name = prevName
        savedFilePath = null
        clearDirty()
        updateScriptName()
    }
    renderStepList()
    updateToolbarState()
    if (result.warnings?.length) {
        showLog()
        for (const w of result.warnings) logInfo('Import: ' + w)
    }
}

async function newScript(): Promise<void> {
    if (script.steps.length > 0 || isDirty) {
        const ok = await showInlineConfirm('Start a new script? Unsaved changes will be lost.', 'Discard')
        if (!ok) return
    }
    script = blankScript()
    savedFilePath = null
    clearDirty()
    updateScriptName()
    renderStepList()
    updateToolbarState()
}

// --- Init ---

async function init(): Promise<void> {
    injectButtonIcons()
    stepEditorPopup = new StepEditorPopup()

    const data = await getInitialData()
    script = data.script
    savedFilePath = data.initialFilePath
    if (data.initialError) {
        showToast(data.initialError)
    }
    // Surface lossy-conversion notices from a RASP open the same way the in-app
    // RASP import does: open the log and write one line per warning.
    if (data.initialWarnings.length > 0) {
        showLog()
        for (const w of data.initialWarnings) logInfo('Import: ' + w)
    }
    if (data.initialDeviceIp) {
        selectedDeviceIp = data.initialDeviceIp
    }

    migrateSteps(script.steps)
    renderStepList()
    void renderLibrary()
    updateToolbarState()
    updateScriptName()

    // Wire up <rokdock-remote> component events
    const remoteElement = document.getElementById('remote-component') as HTMLElement

    // The static remote image in scriptEditor.html carries no src (assets ship via
    // Vite imports now, not the public dir), so point it at the bundled URL here.
    const mainRemoteImg = remoteElement.querySelector('img[slot="image"]') as HTMLImageElement | null
    if (mainRemoteImg) mainRemoteImg.src = remoteImageUrl

    remoteElement.addEventListener('remote-keypress', (e: Event) => {
        if (suppressNextKeypress) { suppressNextKeypress = false; return }
        if (isRecording) recordKeyPress((e as CustomEvent<{ key: string }>).detail.key)
    })

    remoteElement.addEventListener('remote-keydown', (e: Event) => {
        if (isRecording) handleHotspotDown((e as CustomEvent<{ key: string }>).detail.key)
    })

    remoteElement.addEventListener('remote-keyup', (e: Event) => {
        if (isRecording) handleHotspotUp((e as CustomEvent<{ key: string }>).detail.key)
    })

    remoteElement.addEventListener('remote-text', (e: Event) => {
        if (isRecording) {
            appendStep({ type: 'text', value: (e as CustomEvent<{ char: string }>).detail.char } as unknown as Step)
            lastKeyTime = Date.now()
        }
    })

    remoteElement.addEventListener('remote-focus-changed', () => { updateDeviceIndicator() })

    ;(document.getElementById('rec-delays-chk') as HTMLInputElement).addEventListener('change', (e: Event) => {
        recordDelays = (e.target as HTMLInputElement).checked
    })

    // Load device list for remote select
    void window.rokdock.discovery.getDevices().then((devices: { ip: string; name: string }[]) => {
        const selectElement = document.getElementById('remote-device-select') as HTMLSelectElement
        selectElement.innerHTML = '<option value="">Select device...</option>'
        for (const device of devices) {
            const opt = document.createElement('option')
            opt.value = device.ip
            opt.textContent = device.name + ' (' + device.ip + ')'
            selectElement.appendChild(opt)
        }
        if (selectedDeviceIp && selectElement.querySelector('option[value="' + selectedDeviceIp + '"]')) {
            selectElement.value = selectedDeviceIp
            updateDeviceIndicator()
        }
    })

    ;(document.getElementById('remote-device-select') as HTMLSelectElement).addEventListener('change', (e: Event) => {
        selectedDeviceIp = (e.target as HTMLSelectElement).value
        updateDeviceIndicator()
        renderStepList()
    })

    ;(document.getElementById('var-add-btn') as HTMLButtonElement).addEventListener('click', () => {
        if (!script.metadata) script.metadata = {}
        if (!script.metadata.variables) script.metadata.variables = {}
        const container = document.getElementById('variables-list') as HTMLElement

        const emptyElement = container.querySelector('div') as HTMLElement | null
        if (emptyElement && emptyElement.style.fontStyle === 'italic') emptyElement.remove()

        const section = document.getElementById('variables-section')
        if (section && !section.hasAttribute('open')) section.setAttribute('open', '')

        const addRow = document.createElement('div')
        addRow.style.cssText = 'display:flex;align-items:center;gap:var(--rokdock-space-xs);margin-bottom:3px'

        const nameInput = document.createElement('input')
        nameInput.className = 'ed-inp'
        nameInput.type = 'text'
        nameInput.placeholder = 'name'
        nameInput.style.cssText = 'width:80px;flex-shrink:0;height:18px;font-size:var(--rokdock-font-sm);padding:0 var(--rokdock-space-xs);font-family:var(--rokdock-font-ui);border-color:var(--rokdock-brand-primary);'

        const valueInput = document.createElement('input')
        valueInput.className = 'ed-inp'
        valueInput.type = 'text'
        valueInput.placeholder = 'default value'
        valueInput.style.cssText = 'flex:1;min-width:0;height:18px;font-size:var(--rokdock-font-sm);padding:0 var(--rokdock-space-xs);font-family:var(--rokdock-font-ui);'

        const cancelButton = document.createElement('button')
        cancelButton.className = 'act'
        cancelButton.title = 'Cancel'
        cancelButton.innerHTML = iconX

        const commit = (): void => {
            const name = nameInput.value.trim()
            if (!name) { addRow.remove(); renderVariables(); return }
            ;(script.metadata!.variables as Record<string, string>)[name] = valueInput.value
            renderVariables()
        }

        cancelButton.addEventListener('click', () => { addRow.remove(); renderVariables() })
        nameInput.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Tab') { e.preventDefault(); valueInput.focus() }
            if (e.key === 'Enter') { e.preventDefault(); valueInput.focus() }
            if (e.key === 'Escape') { addRow.remove(); renderVariables() }
        })
        valueInput.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') { e.preventDefault(); commit() }
            if (e.key === 'Escape') { addRow.remove(); renderVariables() }
        })
        valueInput.addEventListener('blur', () => {
            if (nameInput.value.trim()) commit()
        })

        addRow.appendChild(nameInput)
        addRow.appendChild(valueInput)
        addRow.appendChild(cancelButton)
        container.appendChild(addRow)
        nameInput.focus()
    })

    ;(document.getElementById('sel-loop-btn') as HTMLButtonElement).addEventListener('click', () => {
        const paths = getSelectedPaths()
        if (paths.length === 0) return
        groupSelectionIntoLoop(paths)
    })

    ;(document.getElementById('sel-delete-btn') as HTMLButtonElement).addEventListener('click', () => {
        const paths = getSelectedPaths()
        if (paths.length === 0) return
        deleteSteps(paths)
    })

    ;(document.getElementById('sel-block-btn') as HTMLButtonElement).addEventListener('click', () => {
        if (getSelectedPaths().length === 0) return
        const prompt = document.getElementById('block-name-prompt') as HTMLElement
        ;(document.getElementById('block-name-input') as HTMLInputElement).value = ''
        document.getElementById('block-name-err')?.classList.remove('visible')
        const buttonRect = (document.getElementById('sel-block-btn') as HTMLElement).getBoundingClientRect()
        prompt.style.left = buttonRect.left + 'px'
        prompt.style.bottom = (window.innerHeight - buttonRect.top + 6) + 'px'
        prompt.style.top = ''
        prompt.classList.add('visible')
        ;(document.getElementById('block-name-input') as HTMLInputElement).focus()
    })

    ;(document.getElementById('sel-clear-btn') as HTMLButtonElement).addEventListener('click', () => {
        clearSelection()
        renderStepList()
    })

    ;(document.getElementById('block-name-confirm') as HTMLButtonElement).addEventListener('click', () => {
        const input = document.getElementById('block-name-input') as HTMLInputElement
        const errorElement = document.getElementById('block-name-err') as HTMLElement
        const name = input.value.trim()
        errorElement.textContent = ''
        errorElement.classList.remove('visible')
        if (!name) {
            errorElement.textContent = 'Name is required'
            errorElement.classList.add('visible')
            return
        }
        const existing = getBlockNames(script.steps).includes(name)
        if (existing) {
            errorElement.textContent = 'A block named "' + name + '" already exists'
            errorElement.classList.add('visible')
            return
        }
        document.getElementById('block-name-prompt')?.classList.remove('visible')
        groupSelectionAsBlock(name)
    })

    ;(document.getElementById('block-name-cancel') as HTMLButtonElement).addEventListener('click', () => {
        document.getElementById('block-name-prompt')?.classList.remove('visible')
        ;(document.getElementById('block-name-input') as HTMLInputElement).value = ''
        document.getElementById('block-name-err')?.classList.remove('visible')
    })

    document.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Escape' && selectedSet.size > 0) {
            clearSelection()
            renderStepList()
        }
    })

    // Toolbar button wiring
    ;(document.getElementById('play-btn') as HTMLButtonElement).addEventListener('click', () => void playScript())
    ;(document.getElementById('stop-btn') as HTMLButtonElement).addEventListener('click', () => void stopPlayback())
    ;(document.getElementById('save-btn') as HTMLButtonElement).addEventListener('click', () => void saveScript())
    ;(document.getElementById('record-btn') as HTMLButtonElement).addEventListener('click', () => {
        if (isRecording) stopRecording(); else startRecording()
    })
    ;(document.getElementById('stop-record-btn') as HTMLButtonElement).addEventListener('click', stopRecording)
    ;(document.getElementById('add-step-btn') as HTMLButtonElement).addEventListener('click', () => {
        showStepPicker(document.getElementById('add-step-btn') as HTMLElement, null, 'end')
    })
    ;(document.getElementById('refresh-lib-btn') as HTMLButtonElement).addEventListener('click', () => void renderLibrary())
    ;(document.getElementById('new-btn') as HTMLButtonElement).addEventListener('click', () => void newScript())
    ;(document.getElementById('lib-new-hdr-btn') as HTMLButtonElement).addEventListener('click', () => void newScript())

    // Log panel toggle
    ;(document.getElementById('log-toggle-btn') as HTMLElement).addEventListener('click', (e: MouseEvent) => {
        if ((e.target as HTMLElement).closest('#clear-log-btn')) return
        document.getElementById('log-panel')?.classList.toggle('collapsed')
    })

    ;(document.getElementById('clear-log-btn') as HTMLButtonElement).addEventListener('click', () => {
        clearLog()
        document.getElementById('log-panel')?.classList.remove('active')
    })

    // Keypress wait input
    const commitKeypressWait = (): void => {
        const input = document.getElementById('keypress-wait-inp') as HTMLInputElement
        const parsedWait = parseFloat(input.value)
        const wait = isNaN(parsedWait) || parsedWait < 0 ? 0 : parsedWait
        input.value = String(wait)
        if (!script.metadata) script.metadata = {}
        const prev = script.metadata.defaultKeypressWait
        if (wait > 0) {
            script.metadata.defaultKeypressWait = wait
        } else {
            delete script.metadata.defaultKeypressWait
        }
        if (prev !== script.metadata.defaultKeypressWait) markDirty()
    }
    ;(document.getElementById('keypress-wait-inp') as HTMLInputElement).addEventListener('change', commitKeypressWait)
    ;(document.getElementById('keypress-wait-inp') as HTMLInputElement).addEventListener('blur', commitKeypressWait)

    // Script name rename
    ;(document.getElementById('script-name-display') as HTMLElement).addEventListener('click', function (this: HTMLElement) {
        const span = this
        const current = script.name
        const input = document.createElement('input')
        input.value = current
        input.style.cssText = 'flex:1;background:var(--rokdock-white-subtle);border:none;border-bottom:1px solid var(--rokdock-white-bright);color:rgba(255, 255, 255, 0.95);font-size:var(--rokdock-font-sm);font-style:normal;padding:0 var(--rokdock-space-xs);outline:none;min-width:0;width:120px;font-family:var(--rokdock-font-mono);border-radius:var(--rokdock-radius-sm);'
        span.replaceWith(input)
        input.focus()
        input.select()
        const commit = (): void => {
            const newName = input.value.trim() || current
            script.name = newName
            input.replaceWith(span)
            updateScriptName()
        }
        input.addEventListener('blur', commit)
        input.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') { e.preventDefault(); input.blur() }
            if (e.key === 'Escape') { input.value = current; input.blur() }
        })
    })

    // Import RASP from file
    ;(document.getElementById('import-btn') as HTMLButtonElement).addEventListener('click', async () => {
        const button = document.getElementById('import-btn') as HTMLButtonElement
        button.disabled = true
        setStatus('Importing...', true)
        let result: { ok: boolean; script?: ScriptFile; warnings?: string[]; error?: string }
        try {
            result = await window.rokdock.scriptEditor.importRasp()
        } catch (e) {
            setStatus(); button.disabled = false
            showLog(); logFail('Import error: ' + String(e)); return
        }
        setStatus(); button.disabled = false
        if (!result.ok) {
            if ((result as { error?: string }).error) { showLog(); logFail('Import failed: ' + (result as { error: string }).error) }
            return
        }
        if (!result.script) { showLog(); logFail('Import returned no script'); return }
        script = result.script
        savedFilePath = null
        clearDirty()
        updateScriptName()
        renderStepList()
        updateToolbarState()
        if (result.warnings?.length) {
            showLog()
            for (const w of result.warnings) logInfo('Import: ' + w)
        }
    })

    // Paste RASP from clipboard dialog
    ;(document.getElementById('paste-rasp-btn') as HTMLButtonElement).addEventListener('click', async () => {
        const yamlText = await showPasteRaspDialog()
        if (!yamlText) return
        const button = document.getElementById('paste-rasp-btn') as HTMLButtonElement
        button.disabled = true
        await importRaspFromText(yamlText)
        button.disabled = false
    })

    // Global paste: if clipboard looks like RASP, import it
    document.addEventListener('paste', async (e: ClipboardEvent) => {
        const tag = (document.activeElement as HTMLElement)?.tagName ?? ''
        if (tag === 'INPUT' || tag === 'TEXTAREA') return
        const text = e.clipboardData?.getData('text') ?? ''
        if (!text || !looksLikeRasp(text)) return
        e.preventDefault()
        await importRaspFromText(text)
    })

    // Export RASP
    ;(document.getElementById('export-btn') as HTMLButtonElement).addEventListener('click', async () => {
        const result = await window.rokdock.scriptEditor.exportRasp(script)
        if (!result.ok) { showLog(); logFail('Export failed: ' + ((result as unknown as { error?: string }).error ?? '')); return }
        if (result.warnings?.length) {
            showLog()
            for (const w of result.warnings) logInfo('Export: ' + w)
        }
    })

    // Copy RASP to clipboard
    ;(document.getElementById('copy-rasp-btn') as HTMLButtonElement).addEventListener('click', async () => {
        if (!script.steps.length) { setStatus('Nothing to copy'); return }
        const button = document.getElementById('copy-rasp-btn') as HTMLButtonElement
        button.disabled = true
        const result = await window.rokdock.scriptEditor.copyRasp(script)
        if (!result.ok) { showLog(); logFail('Copy failed: ' + ((result as unknown as { error?: string }).error ?? '')); button.disabled = false; return }
        if (result.yaml) await navigator.clipboard.writeText(result.yaml)
        setStatus('Copied to clipboard')
        if (result.warnings?.length) {
            showLog()
            for (const w of result.warnings) logInfo('Copy: ' + w)
        }
        button.disabled = false
    })

    // Engine events
    window.rokdock.scriptEditor.onEngineEvent(handleEngineEvent)

    // Load steps pushed from recorder
    window.rokdock.scriptEditor.onLoadSteps((steps: Step[], name: string, filePath: string | null) => {
        script.steps = steps
        if (name) script.name = name
        savedFilePath = filePath ?? null
        clearDirty()
        updateScriptName()
        renderStepList()
        updateToolbarState()
    })

    // Refresh library when scripts change in another window
    window.rokdock.scriptEditor.onScriptsChanged(() => { void renderLibrary() })

    if (data.startRecording) startRecording()
}

void init()
