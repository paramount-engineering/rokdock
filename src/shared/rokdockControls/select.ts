/**
 * <rokdock-select> custom element.
 *
 * A styled dropdown wrapping a native <select> element. Accepts <option>
 * children. Attributes: value, disabled. Emits 'rokdock-change' with
 * detail { value: string } on selection change.
 */
import { createTemplate, emitEvent } from './base'

const CSS = `
    :host { display: inline-flex; }
    select {
        flex: 1;
        min-width: 0;
        font-family: var(--rokdock-font-ui);
        font-size: var(--rokdock-font-base);
        color: var(--rokdock-text-primary);
        background: var(--rokdock-bg-input);
        border: 1px solid var(--rokdock-border);
        border-radius: var(--rokdock-radius-md);
        padding: var(--rokdock-space-xs) var(--rokdock-space-sm);
        outline: none;
        cursor: pointer;
        transition: border-color var(--rokdock-transition-fast);
    }
    select:focus {
        border-color: var(--rokdock-focus-border);
    }
    :host([disabled]) { opacity: 0.45; pointer-events: none; }
`

const template = createTemplate(CSS, `<select part="select"><slot></slot></select>`)

class RokdockSelect extends HTMLElement {
    private select!: HTMLSelectElement
    private observer!: MutationObserver

    static get observedAttributes() { return ['value', 'disabled'] }

    constructor() {
        super()
        const shadow = this.attachShadow({ mode: 'open' })
        shadow.appendChild(template.content.cloneNode(true))
        this.select = shadow.querySelector('select')!
        this.observer = new MutationObserver(() => this.populateOptions())
    }

    connectedCallback() {
        // Move light DOM <option> elements into the shadow select
        this.populateOptions()
        this.select.addEventListener('change', this.onChange)
        this.observer.observe(this, { childList: true })
    }

    disconnectedCallback() {
        this.observer.disconnect()
        this.select.removeEventListener('change', this.onChange)
    }

    private populateOptions() {
        this.select.innerHTML = ''
        Array.from(this.children).forEach(child => {
            this.select.appendChild(child.cloneNode(true))
        })
        const val = this.getAttribute('value')
        if (val !== null) this.select.value = val
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (name === 'value' && value !== null) this.select.value = value
        if (name === 'disabled') this.select.disabled = value !== null
    }

    get value(): string { return this.select.value }
    set value(newValue: string) { this.setAttribute('value', newValue) }

    private onChange = () => {
        this.setAttribute('value', this.select.value)
        emitEvent(this, 'rokdock-change', { value: this.select.value })
    }
}

customElements.define('rokdock-select', RokdockSelect)
