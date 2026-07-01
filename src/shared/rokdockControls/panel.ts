/**
 * <rokdock-panel> custom element.
 *
 * A simple container with an elevated card appearance (background + shadow).
 * Use as a visual grouping surface when a section needs clear separation
 * from the surrounding background. Accepts arbitrary slotted content.
 */
import { createTemplate } from './base'

const CSS = `
    :host {
        display: flex;
        flex-direction: column;
        background: linear-gradient(160deg,
            var(--rokdock-panel-gradient-start) 0%,
            var(--rokdock-panel-gradient-end) 100%);
        border: 1px solid var(--rokdock-border-light);
        border-radius: var(--rokdock-radius-lg);
        box-shadow: var(--rokdock-shadow-panel);
        overflow: hidden;
    }
    :host([flat]) {
        background: var(--rokdock-bg-panel);
        box-shadow: none;
    }
    .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--rokdock-space-sm) var(--rokdock-space-md);
        position: relative;
    }
    .header::after {
        content: '';
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 1px;
        background: linear-gradient(90deg, transparent, var(--rokdock-accent-divider), transparent);
    }
    .header:empty { display: none; }
    .body {
        flex: 1;
        overflow: auto;
    }
`

const template = createTemplate(CSS, `
    <div class="header" part="header"><slot name="header"></slot></div>
    <div class="body" part="body"><slot></slot></div>
`)

class RokdockPanel extends HTMLElement {
    constructor() {
        super()
        const shadow = this.attachShadow({ mode: 'open' })
        shadow.appendChild(template.content.cloneNode(true))
    }
}

customElements.define('rokdock-panel', RokdockPanel)
