/**
 * <rokdock-segmented> custom element.
 *
 * A horizontal segmented button group for a small set of mutually exclusive
 * choices. Attributes: value (the selected value), options (a JSON array of
 * { value, label }). Emits 'rokdock-change' with detail { value: string }.
 */
import { createTemplate, emitEvent } from './base'

const CSS = `
    :host {
        display: inline-flex;
        background: var(--rokdock-bg-input);
        border: 1px solid var(--rokdock-border);
        border-radius: var(--rokdock-radius-sm);
        padding: 2px;
        gap: 2px;
    }
    button {
        appearance: none;
        border: none;
        background: transparent;
        color: var(--rokdock-text-dim);
        font-family: var(--rokdock-font-ui);
        font-size: var(--rokdock-font-sm);
        padding: 4px 12px;
        border-radius: calc(var(--rokdock-radius-sm) - 2px);
        cursor: pointer;
        transition: background var(--rokdock-transition-fast),
                    color var(--rokdock-transition-fast);
    }
    button[aria-checked="true"] {
        background: var(--rokdock-brand-primary);
        /* The selected background is the dark brand purple in BOTH themes, so the
           label must use the on-brand light text (white) rather than --rokdock-text-bright,
           which flips to near-black in light mode and would be dark-on-dark. */
        color: var(--rokdock-btn-text);
    }
    @media (prefers-reduced-motion: reduce) {
        button { transition: none; }
    }
`

const template = createTemplate(CSS, `<div class="group" part="group" role="radiogroup"></div>`)

interface SegmentOption { value: string; label: string }

class RokdockSegmented extends HTMLElement {
    static get observedAttributes() { return ['value', 'options'] }

    constructor() {
        super()
        const shadow = this.attachShadow({ mode: 'open' })
        shadow.appendChild(template.content.cloneNode(true))
    }

    connectedCallback() { this.render() }

    get value(): string { return this.getAttribute('value') ?? '' }
    set value(newValue: string) { this.setAttribute('value', newValue) }

    attributeChangedCallback() { this.render() }

    private parseOptions(): SegmentOption[] {
        const raw = this.getAttribute('options')
        if (!raw) return []
        try {
            const parsed: unknown = JSON.parse(raw)
            return Array.isArray(parsed) ? parsed as SegmentOption[] : []
        } catch {
            return []
        }
    }

    private selectOption(opt: SegmentOption) {
        if (this.value !== opt.value) {
            this.value = opt.value
            emitEvent(this, 'rokdock-change', { value: opt.value })
        }
    }

    private render() {
        const group = this.shadowRoot?.querySelector('.group')
        if (!group) return
        const current = this.value
        const options = this.parseOptions()
        group.replaceChildren()

        const hasMatch = options.some(opt => opt.value === current)

        options.forEach((opt, index) => {
            const btn = document.createElement('button')
            btn.type = 'button'
            btn.textContent = opt.label
            btn.setAttribute('role', 'radio')
            const isSelected = opt.value === current
            btn.setAttribute('aria-checked', String(isSelected))
            btn.tabIndex = (isSelected || (!hasMatch && index === 0)) ? 0 : -1

            btn.addEventListener('click', () => { this.selectOption(opt) })

            btn.addEventListener('keydown', (event: KeyboardEvent) => {
                const buttons = Array.from(group.querySelectorAll<HTMLButtonElement>('button'))
                const currentIndex = buttons.indexOf(btn)
                let targetIndex = -1

                if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                    targetIndex = (currentIndex + 1) % buttons.length
                } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                    targetIndex = (currentIndex - 1 + buttons.length) % buttons.length
                } else if (event.key === 'Home') {
                    targetIndex = 0
                } else if (event.key === 'End') {
                    targetIndex = buttons.length - 1
                }

                if (targetIndex !== -1) {
                    event.preventDefault()
                    const targetOption = options[targetIndex]
                    this.selectOption(targetOption)
                    buttons[targetIndex].focus()
                }
            })

            group.appendChild(btn)
        })
    }
}

customElements.define('rokdock-segmented', RokdockSegmented)
