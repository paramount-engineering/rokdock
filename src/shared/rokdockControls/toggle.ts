/**
 * <rokdock-toggle> custom element.
 *
 * A styled on/off switch. Attributes: checked (boolean), disabled. The label
 * text is provided via the default slot. Emits 'rokdock-change' with
 * detail { checked: boolean } on toggle.
 */
import { createTemplate, emitEvent } from './base'

const CSS = `
    :host {
        display: inline-flex;
        align-items: center;
        gap: var(--rokdock-space-sm);
        cursor: pointer;
        user-select: none;
    }
    :host([disabled]) { opacity: 0.45; pointer-events: none; }

    .track {
        position: relative;
        width: 28px;
        height: 16px;
        background: var(--rokdock-bg-active);
        border: 1px solid var(--rokdock-border);
        border-radius: 8px;
        transition: background var(--rokdock-transition-fast),
                    border-color var(--rokdock-transition-fast);
    }
    :host([checked]) .track {
        background: var(--rokdock-brand-primary);
        border-color: var(--rokdock-brand-primary-light);
    }

    .thumb {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 10px;
        height: 10px;
        background: var(--rokdock-toggle-thumb);
        border-radius: 50%;
        transition: transform var(--rokdock-transition-fast),
                    background var(--rokdock-transition-fast);
    }
    :host([checked]) .thumb {
        transform: translateX(12px);
        background: var(--rokdock-toggle-thumb);
    }

    .label-text {
        font-size: var(--rokdock-font-sm);
        color: var(--rokdock-text-primary);
    }
`

const template = createTemplate(CSS, `
    <div class="track" part="track">
        <div class="thumb" part="thumb"></div>
    </div>
    <span class="label-text"><slot></slot></span>
`)

class RokdockToggle extends HTMLElement {
    static get observedAttributes() { return ['checked', 'disabled'] }

    constructor() {
        super()
        const shadow = this.attachShadow({ mode: 'open' })
        shadow.appendChild(template.content.cloneNode(true))
    }

    connectedCallback() {
        this.addEventListener('click', this.handleClick)
        this.setAttribute('role', 'switch')
        this.setAttribute('tabindex', '0')
        this.addEventListener('keydown', this.handleKeydown)
    }

    disconnectedCallback() {
        this.removeEventListener('click', this.handleClick)
        this.removeEventListener('keydown', this.handleKeydown)
    }

    get checked(): boolean { return this.hasAttribute('checked') }
    set checked(val: boolean) {
        if (val) this.setAttribute('checked', '')
        else this.removeAttribute('checked')
    }

    attributeChangedCallback(name: string) {
        if (name === 'checked') {
            this.setAttribute('aria-checked', String(this.checked))
        } else if (name === 'disabled') {
            this.setAttribute('aria-disabled', String(this.hasAttribute('disabled')))
        }
    }

    private handleClick = () => {
        if (this.hasAttribute('disabled')) return
        this.checked = !this.checked
        emitEvent(this, 'rokdock-change', { checked: this.checked })
    }

    private handleKeydown = (e: KeyboardEvent) => {
        if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault()
            this.handleClick()
        }
    }
}

customElements.define('rokdock-toggle', RokdockToggle)
