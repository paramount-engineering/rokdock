/**
 * <rokdock-toolbar> custom element.
 *
 * A fixed-height horizontal toolbar strip (TOOLBAR_HEIGHT px). Supports
 * 'left' and 'right' named slots for aligned content groups; unnamed slot
 * content is centered. Used as the top bar in tool windows (Script Editor,
 * JSON Editor, etc.) as well as the main application title bar area.
 */
import { createTemplate } from './base'
import { TOOLBAR_HEIGHT } from '../toolbarConstants'

const CSS = `
    :host {
        flex-shrink: 0;
        display: block;
        height: ${TOOLBAR_HEIGHT}px;
        border-bottom: 1px solid var(--rokdock-black-subtle);
        background: linear-gradient(180deg, var(--rokdock-brand-primary), var(--rokdock-brand-primary-dark));
        box-shadow: inset 0 1px 0 var(--rokdock-white-subtle), 0 1px 4px var(--rokdock-black-medium);
        user-select: none;
    }
    .inner {
        display: flex;
        align-items: center;
        height: 100%;
        padding: 0 6px;
        gap: 6px;
    }
    ::slotted([slot="left"]),
    ::slotted([slot="right"]) {
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .spacer { flex: 1; }
`

const template = createTemplate(CSS, `
    <div class="inner">
        <slot name="left"></slot>
        <slot></slot>
        <div class="spacer"></div>
        <slot name="right"></slot>
    </div>
`)

class RokdockToolbar extends HTMLElement {
    constructor() {
        super()
        const shadow = this.attachShadow({ mode: 'open' })
        shadow.appendChild(template.content.cloneNode(true))
    }
}

customElements.define('rokdock-toolbar', RokdockToolbar)
