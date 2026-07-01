/**
 * <rokdock-tabs> and <rokdock-tab> custom elements.
 *
 * A tab bar container (<rokdock-tabs>) that manages a set of tab items
 * (<rokdock-tab>). Tab attributes: label, closable, active. Emits
 * 'rokdock-select' and 'rokdock-close' (no detail payload) on tab click and
 * close. Used for the JSON editor window.
 */
import { createTemplate, emitEvent } from './base'

/* --- Tab Bar Container --- */
const TABS_CSS = `
    :host {
        display: flex;
        align-items: end;
        gap: 1px;
        padding: 0 var(--rokdock-space-xs);
        background: var(--rokdock-tab-bg);
        min-height: 30px;
        overflow-x: auto;
        overflow-y: hidden;
        user-select: none;
    }
    :host::-webkit-scrollbar { height: 0; }
    ::slotted(rokdock-tab) {
        flex-shrink: 0;
    }
`

const tabsTemplate = createTemplate(TABS_CSS, `<slot></slot>`)

class RokdockTabs extends HTMLElement {
    constructor() {
        super()
        const shadow = this.attachShadow({ mode: 'open' })
        shadow.appendChild(tabsTemplate.content.cloneNode(true))
    }
}

customElements.define('rokdock-tabs', RokdockTabs)

/* --- Individual Tab --- */
const TAB_CSS = `
    :host {
        display: inline-flex;
        align-items: center;
        gap: var(--rokdock-space-xs);
        padding: var(--rokdock-space-xs) var(--rokdock-space-md);
        font-size: var(--rokdock-font-xs);
        color: var(--rokdock-text-dim);
        background: transparent;
        border-bottom: 2px solid transparent;
        cursor: pointer;
        transition: color var(--rokdock-transition-fast),
                    background var(--rokdock-transition-fast),
                    border-color var(--rokdock-transition-fast);
        white-space: nowrap;
    }
    :host(:hover) {
        color: var(--rokdock-text-primary);
        background: var(--rokdock-tab-hover);
    }
    :host([active]) {
        color: var(--rokdock-text-bright);
        border-bottom-color: var(--rokdock-brand-primary);
        background: var(--rokdock-tab-active);
    }

    .label { flex: 1; }
    .dirty {
        width: 6px; height: 6px;
        border-radius: 50%;
        background: var(--rokdock-brand-primary);
        display: none;
    }
    :host([dirty]) .dirty { display: block; }

    .close {
        display: none;
        width: 14px; height: 14px;
        border-radius: var(--rokdock-radius-sm);
        background: transparent;
        border: none;
        color: var(--rokdock-text-muted);
        cursor: pointer;
        padding: 0;
        align-items: center;
        justify-content: center;
        font-size: var(--rokdock-font-xs);
        line-height: 1;
        transition: background var(--rokdock-transition-fast),
                    color var(--rokdock-transition-fast);
    }
    :host([closable]) .close { display: inline-flex; }
    .close:hover {
        background: var(--rokdock-bg-hover);
        color: var(--rokdock-text-bright);
    }
`

const tabTemplate = createTemplate(TAB_CSS, `
    <span class="dirty" part="dirty"></span>
    <span class="label" part="label"></span>
    <button class="close" part="close">&times;</button>
`)

class RokdockTab extends HTMLElement {
    private labelEl!: HTMLSpanElement
    private closeBtn!: HTMLButtonElement

    static get observedAttributes() { return ['label', 'active', 'dirty', 'closable'] }

    constructor() {
        super()
        const shadow = this.attachShadow({ mode: 'open' })
        shadow.appendChild(tabTemplate.content.cloneNode(true))
        this.labelEl = shadow.querySelector('.label')!
        this.closeBtn = shadow.querySelector('.close')!
    }

    connectedCallback() {
        this.addEventListener('click', this.onSelect)
        this.closeBtn.addEventListener('click', this.onClose)
    }

    disconnectedCallback() {
        this.removeEventListener('click', this.onSelect)
        this.closeBtn.removeEventListener('click', this.onClose)
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (name === 'label') this.labelEl.textContent = value ?? ''
    }

    private onSelect = (e: Event) => {
        if ((e.target as HTMLElement).closest('.close')) return
        emitEvent(this, 'rokdock-select')
    }

    private onClose = (e: Event) => {
        e.stopPropagation()
        emitEvent(this, 'rokdock-close')
    }
}

customElements.define('rokdock-tab', RokdockTab)
