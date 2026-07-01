/**
 * <rokdock-slider> custom element.
 *
 * A labeled range slider with numeric display. Attributes: min, max, step,
 * value, disabled, label-width, track-background. The label is provided via the
 * 'label' slot. Emits 'rokdock-change' with detail { value: number } on input.
 * Used for settings like font size, scan interval, zoom level, and color
 * adjustments.
 *
 * label-width: when set, the label column is given that exact width so multiple
 * sliders in a group can align their tracks at the same x position.
 *
 * track-background: when set, this CSS background value is applied to the range
 * input so callers can render a gradient track (e.g. a color preview). When
 * absent, the default --rokdock-border fill is used unchanged.
 */
import { clampToRange, createTemplate, emitEvent } from './base'

const CSS = `
    :host {
        display: flex;
        align-items: center;
        gap: var(--rokdock-space-sm);
    }
    :host([disabled]) { opacity: 0.45; pointer-events: none; }

    .label {
        font-size: var(--rokdock-font-sm);
        color: var(--rokdock-text-muted);
        white-space: nowrap;
        min-width: fit-content;
    }

    input[type="range"] {
        -webkit-appearance: none;
        appearance: none;
        flex: 1;
        height: 4px;
        background: var(--rokdock-border);
        border-radius: 2px;
        outline: none;
        cursor: pointer;
    }
    input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 14px;
        height: 14px;
        background: var(--rokdock-brand-primary);
        border: 2px solid var(--rokdock-brand-primary-light);
        border-radius: 50%;
        cursor: pointer;
        transition: transform var(--rokdock-transition-fast);
    }
    input[type="range"]::-webkit-slider-thumb:hover {
        transform: scale(1.15);
    }
    input[type="range"]::-webkit-slider-thumb:active {
        transform: scale(0.95);
    }
    input[type="range"]:focus::-webkit-slider-thumb {
        box-shadow: 0 0 0 3px var(--rokdock-brand-primary-faded);
    }

    input[type="number"] {
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
    }
    input[type="number"]:focus {
        border-color: var(--rokdock-focus-border);
    }
    /* Hide spin buttons */
    input[type="number"]::-webkit-inner-spin-button,
    input[type="number"]::-webkit-outer-spin-button {
        -webkit-appearance: none;
        margin: 0;
    }

    .suffix {
        font-size: var(--rokdock-font-xs);
        color: var(--rokdock-text-muted);
        min-width: 14px;
        text-align: left;
    }
`

const template = createTemplate(CSS, `
    <span class="label"><slot name="label"></slot></span>
    <input type="range" part="range">
    <input type="number" part="number">
    <span class="suffix"><slot name="suffix"></slot></span>
`)

class RokdockSlider extends HTMLElement {
    private range!: HTMLInputElement
    private label!: HTMLSpanElement
    private number!: HTMLInputElement

    static get observedAttributes() {
        return ['min', 'max', 'step', 'value', 'disabled', 'label-width', 'track-background']
    }

    constructor() {
        super()
        const shadow = this.attachShadow({ mode: 'open' })
        shadow.appendChild(template.content.cloneNode(true))
        this.range = shadow.querySelector('input[type="range"]')!
        this.label = shadow.querySelector('.label')!
        this.number = shadow.querySelector('input[type="number"]')!
    }

    connectedCallback() {
        this.syncAttributes()
        this.range.addEventListener('input', this.onRangeInput)
        this.number.addEventListener('input', this.onNumberInput)
        this.number.addEventListener('blur', this.onNumberBlur)
    }

    disconnectedCallback() {
        this.range.removeEventListener('input', this.onRangeInput)
        this.number.removeEventListener('input', this.onNumberInput)
        this.number.removeEventListener('blur', this.onNumberBlur)
    }

    attributeChangedCallback() {
        this.syncAttributes()
    }

    get value(): number { return Number(this.range.value) }
    set value(newValue: number) {
        this.setAttribute('value', String(newValue))
    }

    private syncAttributes() {
        const min = this.getAttribute('min') ?? '0'
        const max = this.getAttribute('max') ?? '100'
        const step = this.getAttribute('step') ?? '1'
        const value = this.getAttribute('value') ?? min

        this.range.min = min
        this.range.max = max
        this.range.step = step
        this.range.value = value

        this.number.min = min
        this.number.max = max
        this.number.step = step
        this.number.value = value

        const labelWidth = this.getAttribute('label-width')
        if (labelWidth) {
            this.label.style.minWidth = labelWidth
        } else {
            this.label.style.minWidth = 'fit-content'
        }

        const trackBackground = this.getAttribute('track-background')
        if (trackBackground) {
            this.range.style.background = trackBackground
            this.range.style.borderRadius = '2px'
        } else {
            this.range.style.background = ''
        }
    }

    private onRangeInput = () => {
        this.number.value = this.range.value
        this.setAttribute('value', this.range.value)
        emitEvent(this, 'rokdock-change', { value: Number(this.range.value) })
    }

    private onNumberInput = () => {
        this.range.value = this.number.value
        this.setAttribute('value', this.number.value)
        emitEvent(this, 'rokdock-change', { value: Number(this.number.value) })
    }

    private onNumberBlur = () => {
        const val = clampToRange(Number(this.number.value), Number(this.range.min), Number(this.range.max))
        this.number.value = String(val)
        this.range.value = String(val)
        this.setAttribute('value', String(val))
        emitEvent(this, 'rokdock-change', { value: val })
    }
}

customElements.define('rokdock-slider', RokdockSlider)
