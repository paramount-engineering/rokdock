/**
 * <rokdock-number-input> custom element.
 *
 * A compact numeric input (native spinners hidden). Attributes: min, max,
 * step, value, disabled. Emits 'rokdock-change' with detail { value: number }
 * on change. Clamps input to the [min, max] range.
 */
import { clampToRange, createTemplate, emitEvent } from './base'

const CSS = `
    :host { display: inline-flex; }
    input {
        width: 48px;
        font-family: var(--rokdock-font-mono);
        font-size: var(--rokdock-font-sm);
        color: var(--rokdock-text-primary);
        background: var(--rokdock-bg-input);
        border: 1px solid var(--rokdock-border);
        border-radius: var(--rokdock-radius-sm);
        padding: 2px 4px;
        text-align: center;
        outline: none;
        transition: border-color var(--rokdock-transition-fast);
    }
    input:focus {
        border-color: var(--rokdock-focus-border);
    }
    input::-webkit-inner-spin-button,
    input::-webkit-outer-spin-button {
        -webkit-appearance: none;
        margin: 0;
    }
    :host([disabled]) { opacity: 0.45; pointer-events: none; }
`

const template = createTemplate(CSS, `<input type="number" part="input">`)

class RokdockNumberInput extends HTMLElement {
    private input!: HTMLInputElement
    static get observedAttributes() { return ['min', 'max', 'step', 'value', 'disabled'] }

    constructor() {
        super()
        const shadow = this.attachShadow({ mode: 'open' })
        shadow.appendChild(template.content.cloneNode(true))
        this.input = shadow.querySelector('input')!
    }

    connectedCallback() {
        this.syncAttributes()
        this.input.addEventListener('input', this.onInput)
        this.input.addEventListener('blur', this.onBlur)
    }

    disconnectedCallback() {
        this.input.removeEventListener('input', this.onInput)
        this.input.removeEventListener('blur', this.onBlur)
    }

    attributeChangedCallback() { this.syncAttributes() }

    get value(): number { return Number(this.input.value) }
    set value(newValue: number) { this.setAttribute('value', String(newValue)) }

    private syncAttributes() {
        for (const attr of ['min', 'max', 'step', 'value']) {
            const val = this.getAttribute(attr)
            if (val !== null) this.input[attr as 'min'] = val
        }
    }

    private onInput = () => {
        emitEvent(this, 'rokdock-change', { value: Number(this.input.value) })
    }

    private onBlur = () => {
        const val = clampToRange(Number(this.input.value), Number(this.input.min || 0), Number(this.input.max || Infinity))
        this.input.value = String(val)
        emitEvent(this, 'rokdock-change', { value: val })
    }
}

customElements.define('rokdock-number-input', RokdockNumberInput)
