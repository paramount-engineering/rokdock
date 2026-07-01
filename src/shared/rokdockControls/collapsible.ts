/**
 * <rokdock-collapsible> custom element.
 *
 * An accordion-style collapsible section with a header and body slot.
 * Attributes: label, open (boolean), accent (color string for the left border).
 * Supports a 'badge' slot for inline header badge content.
 * Emits 'rokdock-toggle' with detail { open: boolean } on header click.
 * Used for sidebar sections (Scripts, Deeplinks) and settings groups.
 */
import { createTemplate, emitEvent } from './base'

const CSS = `
    :host {
        display: flex;
        flex-direction: column;
    }
    .header {
        display: flex;
        align-items: center;
        gap: 6px;
        height: 28px;
        padding: 0 12px;
        cursor: pointer;
        user-select: none;
        background: linear-gradient(90deg, var(--rokdock-section-header-bg) 0%, transparent 80%);
        position: relative;
        transition: background 0.1s ease;
    }
    .header::after {
        content: '';
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 1px;
        background: linear-gradient(90deg, transparent, var(--rokdock-accent-divider), transparent);
    }
    .header:hover {
        background: linear-gradient(90deg, var(--rokdock-bg-hover) 0%, transparent 80%);
    }
    :host([no-collapse]) .header:hover {
        background: linear-gradient(90deg, var(--rokdock-section-header-bg) 0%, transparent 80%);
    }
    .chevron {
        width: 9px;
        height: 9px;
        fill: currentColor;
        opacity: 0.6;
        color: var(--rokdock-text-dim);
        transition: transform 0.15s ease;
        flex-shrink: 0;
        transform: rotate(-90deg);
    }
    :host([open]) .chevron {
        transform: rotate(0deg);
    }
    :host([no-collapse]) .chevron {
        display: none;
    }
    :host([no-collapse]) .header {
        cursor: default;
    }
    .label {
        font-size: var(--rokdock-font-sm);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--rokdock-section-header-color);
        flex: 1;
    }
    :host([accent]) .label {
        color: var(--accent-color, var(--rokdock-section-header-color));
    }
    .badge {
        display: flex;
        align-items: center;
    }
    .actions {
        display: flex;
        align-items: center;
        gap: 4px;
    }
    .body {
        display: none;
        overflow: hidden;
    }
    :host([open]) .body {
        display: block;
    }
`

const CHEVRON_SVG = `<svg class="chevron" viewBox="0 0 320 512"><path d="M137.4 374.6c12.5 12.5 32.8 12.5 45.3 0l128-128c9.2-9.2 11.9-22.9 6.9-34.9s-16.6-19.8-29.6-19.8L32 192c-12.9 0-24.6 7.8-29.6 19.8s-2.2 25.7 6.9 34.9l128 128z"/></svg>`

const template = createTemplate(CSS, `
    <div class="header" part="header">
        ${CHEVRON_SVG}
        <span class="label" part="label"></span>
        <span class="badge"><slot name="badge"></slot></span>
        <span class="actions"><slot name="actions"></slot></span>
    </div>
    <div class="body" part="body">
        <slot></slot>
    </div>
`)

class RokdockCollapsible extends HTMLElement {
    private labelEl!: HTMLSpanElement
    private header!: HTMLElement
    private actionsEl!: HTMLElement

    static get observedAttributes() { return ['label', 'open', 'accent'] }

    constructor() {
        super()
        const shadow = this.attachShadow({ mode: 'open' })
        shadow.appendChild(template.content.cloneNode(true))
        this.labelEl = shadow.querySelector('.label')!
        this.header = shadow.querySelector('.header')!
        this.actionsEl = shadow.querySelector('.actions')!
    }

    connectedCallback() {
        this.header.addEventListener('click', this.toggle)
        if (!this.hasAttribute('open') && this.getAttribute('default-open') !== 'false') {
            this.setAttribute('open', '')
        }
    }

    disconnectedCallback() {
        this.header.removeEventListener('click', this.toggle)
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (name === 'label') {
            this.labelEl.textContent = value ?? ''
        } else if (name === 'accent' && value) {
            this.style.setProperty('--accent-color', value)
        }
    }

    get open(): boolean { return this.hasAttribute('open') }
    set open(val: boolean) {
        if (val) this.setAttribute('open', '')
        else this.removeAttribute('open')
    }

    private toggle = (e: Event) => {
        if (this.hasAttribute('no-collapse')) return
        if (e.composedPath().includes(this.actionsEl)) return
        const target = e.target as HTMLElement
        if (target.closest('[data-no-collapse]')) return
        this.open = !this.open
        emitEvent(this, 'rokdock-toggle', { open: this.open })
    }
}

customElements.define('rokdock-collapsible', RokdockCollapsible)
