/**
 * <rokdock-zoom-dock> custom element.
 *
 * A floating zoom dock with a range slider, a value pill, and optional Fit and
 * Actual Size buttons. Attributes: min, max, value (current zoom %),
 * show-fit (boolean), show-actual (boolean). Emits 'rokdock-change' with
 * detail { value } on slider move, 'rokdock-fit' on Fit, and 'rokdock-actual'
 * on Actual Size. Used in the SVG Converter and 9-Patch Editor tool windows
 * for canvas zoom control.
 */
import { createTemplate, emitEvent } from './base'

const CSS = `
    /* ---- Host: floating dock panel ---- */
    :host {
        display: block;
        box-sizing: border-box;
        border-radius: 8px;
        background: var(--rokdock-bg-panel);
        border: 1px solid var(--rokdock-border-light);
        box-shadow: 0 4px 16px var(--rokdock-black-medium);
        user-select: none;
        min-width: min(480px, calc(100vw - 28px));
    }

    /* Grid wrapper - owns padding (immune to outer * reset) */
    .inner {
        display: grid;
        grid-template-columns: auto auto 1fr auto;
        column-gap: 8px;
        align-items: center;
        padding: 8px 14px;
    }

    /* ---- Row label ---- */
    .lbl {
        font-size: var(--rokdock-font-xxs);
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: .06em;
        color: var(--rokdock-text-muted);
    }

    /* ---- Value pill ---- */
    .pill {
        min-width: 44px;
        height: 20px;
        border: 1px solid var(--rokdock-border);
        border-radius: 5px;
        background: var(--rokdock-bg-input);
        color: var(--rokdock-text-primary);
        font-size: var(--rokdock-font-xs);
        font-weight: 600;
        font-family: var(--rokdock-font-mono);
        display: flex;
        align-items: center;
        justify-content: center;
    }

    /* ---- Range slider ---- */
    input[type="range"] {
        -webkit-appearance: none;
        appearance: none;
        min-width: 0;
        height: 14px;
        background: transparent;
        cursor: pointer;
        margin: 0;
    }
    input[type="range"]::-webkit-slider-runnable-track {
        height: 4px;
        border-radius: 999px;
        border: 1px solid var(--rokdock-border);
        background: linear-gradient(90deg,
            var(--rokdock-brand-primary-light) 0%,
            var(--rokdock-brand-primary-light) var(--zd-pct, 10%),
            var(--rokdock-border) var(--zd-pct, 10%),
            var(--rokdock-border) 100%);
    }
    input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: var(--rokdock-brand-primary-light);
        border: 1px solid var(--rokdock-range-thumb-border);
        margin-top: -5px;
        box-shadow: 0 0 0 2px var(--rokdock-bg-panel), 0 1px 2px var(--rokdock-black-medium);
    }
    input[type="range"]::-moz-range-track {
        height: 4px;
        border-radius: 999px;
        border: 1px solid var(--rokdock-border);
        background: var(--rokdock-border);
    }
    input[type="range"]::-moz-range-progress {
        height: 4px;
        border-radius: 999px;
        border: 1px solid var(--rokdock-border);
        background: var(--rokdock-brand-primary-light);
    }
    input[type="range"]::-moz-range-thumb {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: var(--rokdock-brand-primary-light);
        border: 1px solid var(--rokdock-range-thumb-border);
        box-shadow: 0 0 0 2px var(--rokdock-bg-panel), 0 1px 2px var(--rokdock-black-medium);
    }

    /* ---- Actions group (buttons + default slot) ---- */
    .actions {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    /* ---- Dock buttons ---- */
    button {
        height: 20px;
        border: none;
        border-radius: 4px;
        padding: 0 6px;
        background: transparent;
        color: var(--rokdock-text-dim);
        font-size: var(--rokdock-font-xs);
        font-weight: 700;
        font-family: var(--rokdock-font-mono);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background .12s ease;
        flex-shrink: 0;
        outline: none;
    }
    button:hover {
        background: var(--rokdock-bg-hover);
    }
    button svg {
        width: 11px;
        height: 11px;
        display: block;
        pointer-events: none;
    }

    /* ---- Slotted inline actions ---- */
    ::slotted(*) {
        flex-shrink: 0;
    }

    /* ---- Separator ---- */
    .sep {
        grid-column: 1 / -1;
        height: 1px;
        background: var(--rokdock-border-light);
        margin: 5px 0 3px;
        display: none;
    }
    :host(.has-extra) .sep { display: block; }

    /* ---- Extra slot: grid-aligned rows ---- */
    slot[name="extra"] { display: contents; }

    /* Default: slotted extra content spans all columns */
    ::slotted([slot="extra"]) { grid-column: 1 / -1; }

    /* Opt-in: children participate in the shared column grid */
    ::slotted(.zoom-grid-row) { display: contents; }
`

const FIT_SVG = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h4v2H4v2H2V2zm10 0h2v4h-2V4h-2V2h2zM2 10h2v2h2v2H2v-4zm10 2h-2v2h4v-4h-2v2z"/></svg>'

const template = createTemplate(CSS, `
    <div class="inner">
        <span class="lbl" part="label"></span>
        <span class="pill" part="pill"></span>
        <input type="range" part="range">
        <div class="actions">
            <button class="actual-btn" part="actual-btn">1:1</button>
            <button class="fit-btn" part="fit-btn">${FIT_SVG}</button>
            <slot></slot>
        </div>
        <div class="sep"></div>
        <slot name="extra"></slot>
    </div>
`)

class RokdockZoomDock extends HTMLElement {
    private lbl!: HTMLSpanElement
    private pill!: HTMLSpanElement
    private range!: HTMLInputElement
    private fitBtn!: HTMLButtonElement
    private actualBtn!: HTMLButtonElement
    private extraSlot!: HTMLSlotElement
    static get observedAttributes() { return ['min', 'max', 'value', 'label', 'show-fit', 'show-actual'] }

    constructor() {
        super()
        const shadow = this.attachShadow({ mode: 'open' })
        shadow.appendChild(template.content.cloneNode(true))
        this.lbl = shadow.querySelector('.lbl')!
        this.pill = shadow.querySelector('.pill')!
        this.range = shadow.querySelector('input')!
        this.fitBtn = shadow.querySelector('.fit-btn')!
        this.actualBtn = shadow.querySelector('.actual-btn')!
        this.extraSlot = shadow.querySelector('slot[name="extra"]') as HTMLSlotElement
    }

    connectedCallback() {
        this.syncAttributes()
        this.range.addEventListener('input', this.onRangeInput)
        this.fitBtn.addEventListener('click', this.onFitClick)
        this.actualBtn.addEventListener('click', this.onActualClick)
        this.extraSlot.addEventListener('slotchange', this.onExtraSlotChange)
        this.onExtraSlotChange()
    }

    disconnectedCallback() {
        this.range.removeEventListener('input', this.onRangeInput)
        this.fitBtn.removeEventListener('click', this.onFitClick)
        this.actualBtn.removeEventListener('click', this.onActualClick)
        this.extraSlot.removeEventListener('slotchange', this.onExtraSlotChange)
    }

    attributeChangedCallback() { this.syncAttributes() }

    get value(): number { return Number(this.range.value) }
    set value(newValue: number) { this.setAttribute('value', String(newValue)) }

    private syncAttributes() {
        const min = Number(this.getAttribute('min') ?? '10')
        const max = Number(this.getAttribute('max') ?? '800')
        const val = Number(this.getAttribute('value') ?? '100')
        this.range.min = String(min)
        this.range.max = String(max)
        this.range.value = String(val)
        this.pill.textContent = val + '%'
        this.lbl.textContent = this.getAttribute('label') ?? 'Zoom'
        this.fitBtn.style.display = this.hasAttribute('show-fit') ? '' : 'none'
        this.actualBtn.style.display = this.hasAttribute('show-actual') ? '' : 'none'
        this.updateTrackFill(val, min, max)
    }

    private updateTrackFill(val: number, min: number, max: number) {
        const pct = max > min ? ((val - min) / (max - min)) * 100 : 0
        this.range.style.setProperty('--zd-pct', pct + '%')
    }

    private onRangeInput = () => {
        const val = Number(this.range.value)
        const min = Number(this.range.min)
        const max = Number(this.range.max)
        this.pill.textContent = val + '%'
        this.setAttribute('value', String(val))
        this.updateTrackFill(val, min, max)
        emitEvent(this, 'rokdock-change', { value: val })
    }

    private onFitClick = () => emitEvent(this, 'rokdock-fit')
    private onActualClick = () => emitEvent(this, 'rokdock-actual')

    private onExtraSlotChange = () => {
        this.updateExtraVisibility()
    }

    /** Call from outside after toggling display on slotted extra elements. */
    updateExtraVisibility() {
        const hasVisible = this.extraSlot.assignedElements().some(
            el => (el as HTMLElement).style.display !== 'none'
        )
        this.classList.toggle('has-extra', hasVisible)
    }
}

customElements.define('rokdock-zoom-dock', RokdockZoomDock)
