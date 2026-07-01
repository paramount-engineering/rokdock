/**
 * <rokdock-card> custom element.
 *
 * A list item card with icon, content, and actions slots. Used in panels
 * and dialogs to display structured list entries with consistent styling.
 * Emits 'rokdock-select' when the main card area is activated.
 */
import { createTemplate, emitEvent } from './base'

const CSS = `
    :host {
        display: flex;
        align-items: center;
        gap: var(--rokdock-space-sm);
        padding: var(--rokdock-space-sm) var(--rokdock-space-md);
        background: linear-gradient(180deg,
            var(--rokdock-card-gradient-start) 0%,
            var(--rokdock-card-gradient-end) 100%);
        border: 1px solid var(--rokdock-border-light);
        border-radius: var(--rokdock-radius-md);
        box-shadow: var(--rokdock-shadow-subtle);
        cursor: pointer;
        transition: background var(--rokdock-transition-fast),
                    border-color var(--rokdock-transition-fast),
                    box-shadow var(--rokdock-transition-fast);
        user-select: none;
    }
    :host(:hover) {
        border-color: var(--rokdock-border);
        box-shadow: var(--rokdock-shadow-strong);
    }
    :host([selected]) {
        border-left: 2px solid var(--rokdock-brand-primary);
    }

    .icon {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .content {
        flex: 1;
        min-width: 0;
        overflow: hidden;
    }
    .actions {
        display: flex;
        align-items: center;
        gap: var(--rokdock-space-xs);
        opacity: 0;
        transition: opacity var(--rokdock-transition-fast);
    }
    :host(:hover) .actions { opacity: 1; }
`

const template = createTemplate(CSS, `
    <div class="icon"><slot name="icon"></slot></div>
    <div class="content"><slot></slot></div>
    <div class="actions"><slot name="actions"></slot></div>
`)

class RokdockCard extends HTMLElement {
    static get observedAttributes() { return ['selected'] }

    constructor() {
        super()
        const shadow = this.attachShadow({ mode: 'open' })
        shadow.appendChild(template.content.cloneNode(true))
    }

    connectedCallback() {
        this.addEventListener('click', this.handleClick)
    }

    disconnectedCallback() {
        this.removeEventListener('click', this.handleClick)
    }

    private handleClick = () => emitEvent(this, 'rokdock-select')
}

customElements.define('rokdock-card', RokdockCard)
