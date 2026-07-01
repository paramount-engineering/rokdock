/**
 * <rokdock-pill-input> custom element.
 *
 * A label plus a compact numeric input presented as a single horizontal pill unit.
 * Attributes: label, value, suffix, min, max. Emits 'rokdock-change' with
 * detail { value: number } on input. Used for compact label-value pairs in
 * settings forms where full-row inputs would waste space.
 */
import { clampToRange, createTemplate, emitEvent } from './base'

const CSS = `
    :host {
        display: inline-flex;
        align-items: center;
        height: 20px;
        background: var(--rokdock-bg-active);
        border: 1px solid var(--rokdock-border-light);
        border-radius: 10px;
        cursor: default;
        transition: border-color var(--rokdock-transition-fast),
                    background var(--rokdock-transition-fast);
        overflow: hidden;
    }
    :host(:hover) {
        border-color: var(--rokdock-border);
        background: var(--rokdock-bg-hover);
    }
    :host(:focus-within) {
        border-color: var(--rokdock-brand-primary-light);
        background: var(--rokdock-brand-primary-faded);
    }

    .label {
        align-self: stretch;
        display: flex;
        align-items: center;
        font-size: var(--rokdock-font-xxs);
        letter-spacing: 0.07em;
        text-transform: uppercase;
        color: var(--rokdock-text-muted);
        white-space: nowrap;
        padding: 0 6px 0 7px;
        border-right: 1px solid var(--rokdock-border-light);
    }

    .value {
        display: flex;
        align-items: center;
        padding: 0 7px 0 6px;
        gap: 1px;
    }

    input {
        font-family: var(--rokdock-font-mono);
        font-size: var(--rokdock-font-sm);
        color: var(--rokdock-text-primary);
        background: transparent;
        border: none;
        outline: none;
        width: 24px;
        text-align: right;
        padding: 0;
    }

    .suffix {
        font-size: var(--rokdock-font-xs);
        color: var(--rokdock-text-muted);
    }
`

const template = createTemplate(CSS, `
    <span class="label" part="label"></span>
    <span class="value">
        <input type="number" part="input">
        <span class="suffix" part="suffix"></span>
    </span>
`)

class RokdockPillInput extends HTMLElement {
    private labelEl!: HTMLSpanElement
    private input!: HTMLInputElement
    private suffixEl!: HTMLSpanElement

    static get observedAttributes() { return ['label', 'value', 'suffix', 'min', 'max'] }

    constructor() {
        super()
        const shadow = this.attachShadow({ mode: 'open' })
        shadow.appendChild(template.content.cloneNode(true))
        this.labelEl = shadow.querySelector('.label')!
        this.input = shadow.querySelector('input')!
        this.suffixEl = shadow.querySelector('.suffix')!
    }

    connectedCallback() {
        this.input.addEventListener('input', this.onInput)
        this.input.addEventListener('blur', this.onBlur)
    }

    disconnectedCallback() {
        this.input.removeEventListener('input', this.onInput)
        this.input.removeEventListener('blur', this.onBlur)
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (name === 'label') this.labelEl.textContent = value ?? ''
        else if (name === 'value') this.input.value = value ?? ''
        else if (name === 'suffix') this.suffixEl.textContent = value ?? ''
        else if (name === 'min') this.input.min = value ?? ''
        else if (name === 'max') this.input.max = value ?? ''
    }

    get value(): number { return Number(this.input.value) }
    set value(newValue: number) { this.setAttribute('value', String(newValue)) }

    private onInput = () => {
        emitEvent(this, 'rokdock-change', { value: Number(this.input.value) })
    }

    private onBlur = () => {
        const val = clampToRange(Number(this.input.value), Number(this.input.min || 0), Number(this.input.max || Infinity))
        this.input.value = String(val)
        emitEvent(this, 'rokdock-change', { value: val })
    }
}

customElements.define('rokdock-pill-input', RokdockPillInput)
