/**
 * <rokdock-chip> custom element.
 *
 * A small colored badge label. Attributes: color (hex string for the
 * background/border accent). The display text is provided via the default slot.
 * Used to tag items with status or category information in panels and list views.
 */
import { createTemplate } from './base'

const CSS = `
    :host {
        display: inline-flex;
        align-items: center;
        padding: 1px 6px;
        border-radius: var(--rokdock-radius-sm);
        font-size: var(--rokdock-font-xs);
        font-weight: var(--rokdock-weight-semibold);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        white-space: nowrap;
        user-select: none;
        background: var(--chip-bg, var(--rokdock-bg-active));
        color: var(--chip-color, var(--rokdock-text-primary));
        border: 1px solid var(--chip-border, transparent);
    }
`

const template = createTemplate(CSS, `<slot></slot>`)

class RokdockChip extends HTMLElement {
    static get observedAttributes() { return ['color'] }

    constructor() {
        super()
        const shadow = this.attachShadow({ mode: 'open' })
        shadow.appendChild(template.content.cloneNode(true))
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (name === 'color' && value) {
            // Set chip color - use the color for text and a faded version for background
            this.style.setProperty('--chip-color', value)
            this.style.setProperty('--chip-bg', value + '1a') // ~10% opacity hex suffix
            this.style.setProperty('--chip-border', value + '33') // ~20% opacity hex suffix
        }
    }
}

customElements.define('rokdock-chip', RokdockChip)
