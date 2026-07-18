import { createTemplate, emitEvent } from './base'
import { HOTSPOTS, TEXT_ENTRY_OVERLAY } from '../hotspots'
import { DEFAULT_REMOTE_KEY_BINDINGS } from '../remoteKeys'

/** Minimal ECP transport interface - matches the shape exposed by preload */
interface EcpTransport {
    keypress(ip: string, key: string): void
    keydown(ip: string, key: string): void
    keyup(ip: string, key: string): void
    sendText(ip: string, text: string): void
}

function getEcp(): EcpTransport | null {
    return (window as unknown as { rokdock?: { ecp?: EcpTransport } }).rokdock?.ecp ?? null
}

const CSS = `
    :host {
        display: flex;
        flex-direction: column;
        align-items: center;
        position: relative;
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
    }

    .wrapper {
        position: relative;
        width: 100%;
        max-width: 154px;
        margin: 0 auto;
        border-radius: 8px;
    }

    .wrapper.disabled { opacity: 0.35; }
    /* A disabled remote is inert: hotspots must not hover-highlight or accept clicks. */
    .wrapper.disabled .hs-layer { pointer-events: none; }

    ::slotted(img) {
        width: 100%;
        display: block;
        pointer-events: none;
        filter: drop-shadow(0 5px 10px var(--rokdock-shadow-strong)) drop-shadow(0 1px 2px var(--rokdock-shadow-subtle));
        transition: filter .25s;
    }
    /* The focus glow is a drop-shadow on the image, so it follows the remote's
       silhouette (the PNG's alpha) rather than the rectangular wrapper box. */
    :host([keys-active]) ::slotted(img) {
        filter: drop-shadow(0 5px 10px var(--rokdock-shadow-strong))
                drop-shadow(0 1px 2px var(--rokdock-shadow-subtle))
                drop-shadow(0 0 4px var(--rokdock-brand-primary-faded))
                drop-shadow(0 0 8px var(--rokdock-brand-primary-faded));
    }

    .hs-layer { position: absolute; inset: 0; }

    .hotspot {
        position: absolute;
        transform: translate(-50%, -50%);
        border: 1px solid transparent;
        cursor: pointer;
        transition: background .12s, border-color .12s, box-shadow .15s;
        background: transparent;
        padding: 0;
        outline: none;
    }
    .hotspot:hover {
        background: color-mix(in srgb, var(--rokdock-brand-primary) 45%, transparent);
        border-color: color-mix(in srgb, var(--rokdock-brand-primary) 50%, transparent);
        box-shadow: 0 0 8px color-mix(in srgb, var(--rokdock-brand-primary) 55%, transparent);
    }
    .hotspot:active, .hotspot.active {
        background: color-mix(in srgb, var(--rokdock-brand-primary) 70%, transparent);
    }

    .text-overlay {
        position: absolute;
        transform: translate(-50%, -50%);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0 2px;
        overflow: hidden;
        background: var(--rokdock-remote-slot-bg);
        border: 1px solid var(--rokdock-remote-slot-border);
        box-shadow: var(--rokdock-remote-slot-shadow);
    }

    .text-input {
        width: 100%;
        height: 100%;
        border: none;
        outline: none;
        padding: 0 8px 1px;
        background: var(--rokdock-remote-slot-input-bg);
        border-radius: 3px;
        color: var(--rokdock-remote-slot-text);
        font-size: var(--rokdock-font-sm);
        font-family: var(--rokdock-font-ui);
        text-align: center;
        caret-color: var(--rokdock-remote-slot-text);
    }
    .text-input:focus { box-shadow: none; }
    .text-input::placeholder {
        color: var(--rokdock-remote-slot-text);
        opacity: 1;
        font-weight: var(--rokdock-weight-semibold);
    }

    .status {
        display: flex;
        align-items: center;
        gap: 5px;
        white-space: nowrap;
    }

    .status-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--rokdock-text-muted);
        transition: background .2s, box-shadow .2s;
    }
    .status-dot.on {
        background: var(--rokdock-state-online);
        box-shadow: 0 0 6px var(--rokdock-state-online);
    }

    .status-text {
        font-size: var(--rokdock-font-xs);
        color: var(--rokdock-text-muted);
    }
`

const HTML = `
    <div class="wrapper" part="wrapper">
        <slot name="image"></slot>
        <div class="hs-layer"></div>
        <div class="text-overlay">
            <input class="text-input" type="text" placeholder="Type to send..." autocomplete="off" spellcheck="false">
        </div>
    </div>
`

class RokdockRemote extends HTMLElement {
    private textInput: HTMLInputElement | null = null
    private hsLayer: HTMLDivElement | null = null
    private wrapper: HTMLDivElement | null = null
    private hotspotElements = new Map<string, HTMLElement>()
    private disposeFns: Array<() => void> = []
    /** Reverse lookup: event.code -> remote key, built from keyBindings */
    private codeToKey: Record<string, string> = {}

    constructor() {
        super()
        const shadow = this.attachShadow({ mode: 'open' })
        const tmpl = createTemplate(CSS, HTML)
        shadow.appendChild(tmpl.content.cloneNode(true))
        this.rebuildCodeMap()
    }

    connectedCallback() {
        const shadow = this.shadowRoot!
        this.wrapper = shadow.querySelector('.wrapper')
        this.hsLayer = shadow.querySelector('.hs-layer')
        this.textInput = shadow.querySelector('.text-input')

        const overlay = shadow.querySelector('.text-overlay') as HTMLElement
        overlay.style.left = TEXT_ENTRY_OVERLAY.x + '%'
        overlay.style.top = TEXT_ENTRY_OVERLAY.y + '%'
        overlay.style.width = TEXT_ENTRY_OVERLAY.w + '%'
        overlay.style.height = TEXT_ENTRY_OVERLAY.h + '%'
        overlay.style.borderRadius = TEXT_ENTRY_OVERLAY.radius + 'px'

        this.buildHotspots()
        this.setupTextInput()
        this.setupKeyboardHandler()
        this.setupFocusTracking()
        this.updateDisabledState()
    }

    disconnectedCallback() {
        for (const fn of this.disposeFns) fn()
        this.disposeFns = []
    }

    static get observedAttributes() {
        return ['disabled', 'device']
    }

    attributeChangedCallback(name: string) {
        if (name === 'disabled') this.updateDisabledState()
    }

    /** Device IP - when set, the component sends keys/text to this device */
    get device(): string | null {
        return this.getAttribute('device')
    }
    set device(val: string | null) {
        if (val) this.setAttribute('device', val)
        else this.removeAttribute('device')
    }

    get disabled(): boolean {
        return this.hasAttribute('disabled')
    }
    set disabled(val: boolean) {
        if (val) this.setAttribute('disabled', '')
        else this.removeAttribute('disabled')
    }

    get keysActive(): boolean {
        return this.hasAttribute('keys-active')
    }

    get statusText(): string {
        if (this.disabled) return 'No device'
        return this.keysActive ? 'Keys on' : 'Keys off'
    }

    private _keyBindings: Record<string, string> | null = null
    get keyBindings(): Record<string, string> {
        return this._keyBindings ?? { ...DEFAULT_REMOTE_KEY_BINDINGS }
    }
    set keyBindings(val: Record<string, string>) {
        this._keyBindings = val
        this.rebuildCodeMap()
    }

    // Device communication

    // A disabled remote never commands the device, regardless of how a send is reached.
    private sendKeypress(key: string) {
        const ip = this.device
        if (ip && !this.disabled) getEcp()?.keypress(ip, key)
    }

    private sendKeydown(key: string) {
        const ip = this.device
        if (ip && !this.disabled) getEcp()?.keydown(ip, key)
    }

    private sendKeyup(key: string) {
        const ip = this.device
        if (ip && !this.disabled) getEcp()?.keyup(ip, key)
    }

    private sendText(char: string) {
        const ip = this.device
        if (ip && !this.disabled) getEcp()?.sendText(ip, char)
    }

    // Shared key processing

    /** Process a keyboard event against the key binding map.
     *  Returns true if the event was handled. */
    private processKey(e: KeyboardEvent): boolean {
        const mapped = this.codeToKey[e.code]
        if (mapped) {
            e.preventDefault()
            this.pulseKey(mapped)
            this.sendKeypress(mapped)
            emitEvent(this, 'remote-keypress', { key: mapped })
            return true
        }
        if (e.key === 'Backspace') {
            e.preventDefault()
            this.sendKeypress('Backspace')
            emitEvent(this, 'remote-keypress', { key: 'Backspace' })
            return true
        }
        if (e.key.length === 1) {
            e.preventDefault()
            if (this.textInput) this.textInput.value = ''
            this.sendText(e.key)
            emitEvent(this, 'remote-text', { char: e.key })
            return true
        }
        return false
    }

    // Key binding map

    private rebuildCodeMap() {
        const bindings = this.keyBindings
        const map: Record<string, string> = {}
        for (const [remoteKey, code] of Object.entries(bindings)) {
            if (code) map[code] = remoteKey
        }
        this.codeToKey = map
    }

    // Focus tracking

    private setKeysActive(active: boolean) {
        const was = this.keysActive
        if (active === was) return
        if (active) this.setAttribute('keys-active', '')
        else this.removeAttribute('keys-active')
        emitEvent(this, 'remote-focus-changed', { keysActive: active })
    }

    private setupFocusTracking() {
        const onMouseDown = (e: MouseEvent) => {
            // Walk up from the real target to check containment, avoiding composedPath() allocation
            let node = e.target as Node | null
            let inside = false
            while (node) {
                if (node === this.wrapper || node === this) { inside = true; break }
                node = (node as Element).assignedSlot ?? node.parentNode
                // Cross shadow boundary: if parentNode is a document-fragment, step to its host
                if (node && node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
                    node = (node as ShadowRoot).host
                }
            }
            this.setKeysActive(inside && !this.disabled)
        }

        const onWindowBlur = () => {
            this.setKeysActive(false)
        }

        window.addEventListener('mousedown', onMouseDown)
        window.addEventListener('blur', onWindowBlur)
        this.disposeFns.push(() => {
            window.removeEventListener('mousedown', onMouseDown)
            window.removeEventListener('blur', onWindowBlur)
        })
    }

    // Hotspots

    private buildHotspots() {
        if (!this.hsLayer) return
        for (const hs of HOTSPOTS) {
            const hotspotButton = document.createElement('button')
            hotspotButton.className = 'hotspot'
            hotspotButton.title = hs.title
            hotspotButton.style.left = hs.x + '%'
            hotspotButton.style.top = hs.y + '%'
            hotspotButton.style.width = hs.w + '%'
            hotspotButton.style.height = hs.h + '%'
            hotspotButton.style.borderRadius = hs.round ? '50%' : hs.radius + 'px'

            // mousedown/mouseup send keydown/keyup for hold support;
            // click emits keypress (informational, no device send - keydown+keyup already handled it)
            hotspotButton.addEventListener('mousedown', () => {
                hotspotButton.classList.add('active')
                this.sendKeydown(hs.key)
                emitEvent(this, 'remote-keydown', { key: hs.key })
            })
            hotspotButton.addEventListener('mouseup', () => {
                hotspotButton.classList.remove('active')
                this.sendKeyup(hs.key)
                emitEvent(this, 'remote-keyup', { key: hs.key })
            })
            hotspotButton.addEventListener('mouseleave', () => {
                hotspotButton.classList.remove('active')
            })
            hotspotButton.addEventListener('click', () => {
                emitEvent(this, 'remote-keypress', { key: hs.key })
            })

            this.hsLayer.appendChild(hotspotButton)
            this.hotspotElements.set(hs.key, hotspotButton)
        }
    }

    /** Briefly highlight a hotspot button (visual feedback for keyboard shortcuts) */
    pulseKey(key: string): void {
        const element = this.hotspotElements.get(key)
        if (!element) return
        element.classList.add('active')
        setTimeout(() => element.classList.remove('active'), 150)
    }

    // Text input

    private setupTextInput() {
        if (!this.textInput) return
        this.textInput.addEventListener('keydown', (e) => {
            if (this.disabled) return
            this.processKey(e)
        })
    }

    // Window keyboard handler

    private setupKeyboardHandler() {
        const onKeyDown = (e: KeyboardEvent) => {
            if (!this.keysActive || this.disabled) return
            const path = e.composedPath()
            // Text input has its own handler
            if (this.textInput && path.includes(this.textInput)) return
            if (e.ctrlKey || e.metaKey || e.altKey) return
            // Skip text entries outside the component
            const origin = path[0] as HTMLElement
            if (origin && (origin.tagName === 'INPUT' || origin.tagName === 'TEXTAREA'
                || origin.tagName === 'SELECT' || origin.isContentEditable)) return
            this.processKey(e)
        }
        window.addEventListener('keydown', onKeyDown)
        this.disposeFns.push(() => window.removeEventListener('keydown', onKeyDown))
    }

    // Disabled state

    private updateDisabledState() {
        if (this.wrapper) {
            this.wrapper.classList.toggle('disabled', this.disabled)
        }
        if (this.textInput) {
            this.textInput.disabled = this.disabled
            this.textInput.placeholder = this.disabled ? '' : 'Type to send...'
        }
        if (this.disabled) {
            this.setKeysActive(false)
        }
    }
}

customElements.define('rokdock-remote', RokdockRemote)
