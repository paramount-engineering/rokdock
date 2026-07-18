/**
 * <rokdock-settings-gear> custom element.
 *
 * A self-contained gear button for tool-window toolbars. Clicking it dispatches a
 * bubbling, composed 'rokdock-open-appearance' DOM event; the per-window
 * appearanceModalTrigger listens for it and mounts the in-window Appearance modal.
 * The control stays decoupled from how the modal is hosted (it emits an event
 * rather than calling a specific opener). It carries its own styling (matching the
 * theme-invariant .tb-btn look: fixed white on the brand-gradient toolbar) so it
 * renders identically in every tool window regardless of that tool's own CSS.
 */
import { createTemplate } from './base'
import { faSvg } from '../icons'
import { faGear } from '@fortawesome/free-solid-svg-icons'

// The toolbar background is the brand gradient in both themes, so the foreground
// is a fixed white rather than a theme token (matches .tb-btn in the tool CSS).
const CSS = `
    :host {
        display: inline-flex;
    }
    button {
        width: 24px;
        height: 20px;
        border: none;
        border-radius: 4px;
        background: transparent;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        outline: none;
        color: rgba(255, 255, 255, 0.85);
        transition: background .12s, color .12s, box-shadow .12s;
    }
    button:hover {
        background: var(--rokdock-white-medium);
        color: rgba(255, 255, 255, 0.95);
        box-shadow: inset 0 0 0 1px var(--rokdock-white-medium);
    }
    button:active {
        background: var(--rokdock-white-bright);
    }
    button:focus-visible {
        outline: 2px solid var(--rokdock-focus-border);
        outline-offset: 1px;
    }
    svg {
        width: 14px;
        height: 14px;
        fill: currentColor;
    }
`

const template = createTemplate(CSS, `<button part="button" type="button">${faSvg(faGear)}</button>`)

class RokdockSettingsGear extends HTMLElement {
    private button!: HTMLButtonElement

    constructor() {
        super()
        const shadow = this.attachShadow({ mode: 'open' })
        shadow.appendChild(template.content.cloneNode(true))
        this.button = shadow.querySelector('button')!
    }

    connectedCallback() {
        this.button.title = this.getAttribute('title') ?? 'Appearance settings'
        this.button.addEventListener('click', this.handleClick)
    }

    disconnectedCallback() {
        this.button.removeEventListener('click', this.handleClick)
    }

    private handleClick = () => {
        // Composed so it escapes this control's shadow root; bubbling so it reaches
        // the document-level listener registered by appearanceModalTrigger.
        this.dispatchEvent(new CustomEvent('rokdock-open-appearance', { bubbles: true, composed: true }))
    }
}

customElements.define('rokdock-settings-gear', RokdockSettingsGear)
