/**
 * <rokdock-icon-btn> custom element.
 *
 * A compact icon + optional label button used in toolbars and panel headers.
 * Attributes: disabled, title. Emits 'rokdock-click' on activation.
 */
import { createTemplate, emitEvent } from './base'

const CSS = `
    :host {
        display: inline-flex;
    }
    button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: 1px solid transparent;
        border-radius: var(--rokdock-radius-sm);
        color: var(--rokdock-text-dim);
        cursor: pointer;
        padding: 0;
        transition: background var(--rokdock-transition-fast),
                    color var(--rokdock-transition-fast),
                    transform var(--rokdock-transition-fast);
        user-select: none;
        outline: none;
    }
    :host([size="sm"]) button { width: 20px; height: 20px; }
    :host(:not([size])) button,
    :host([size="md"]) button { width: 26px; height: 26px; }
    :host([size="lg"]) button { width: 32px; height: 32px; }

    button:hover:not(:disabled) {
        background: var(--rokdock-bg-hover);
        color: var(--rokdock-text-bright);
    }
    button:active:not(:disabled) {
        transform: scale(0.9);
        background: var(--rokdock-bg-active);
    }
    button:focus-visible {
        outline: 2px solid var(--rokdock-focus-border);
        outline-offset: 1px;
    }
    button:disabled {
        opacity: 0.35;
        cursor: default;
        pointer-events: none;
    }
    ::slotted(svg) {
        width: 14px;
        height: 14px;
        fill: currentColor;
    }
    :host([size="sm"]) ::slotted(svg) { width: 12px; height: 12px; }
    :host([size="lg"]) ::slotted(svg) { width: 16px; height: 16px; }
`

const template = createTemplate(CSS, `
    <button part="button">
        <slot></slot>
    </button>
`)

class RokdockIconBtn extends HTMLElement {
    private button!: HTMLButtonElement

    static get observedAttributes() { return ['disabled', 'title'] }

    constructor() {
        super()
        const shadow = this.attachShadow({ mode: 'open' })
        shadow.appendChild(template.content.cloneNode(true))
        this.button = shadow.querySelector('button')!
    }

    connectedCallback() {
        this.button.addEventListener('click', this.handleClick)
    }

    disconnectedCallback() {
        this.button.removeEventListener('click', this.handleClick)
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (name === 'disabled') {
            this.button.disabled = value !== null
        } else if (name === 'title') {
            this.button.title = value ?? ''
        }
    }

    private handleClick = () => {
        emitEvent(this, 'rokdock-click')
    }
}

customElements.define('rokdock-icon-btn', RokdockIconBtn)
