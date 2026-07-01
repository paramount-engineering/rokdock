/**
 * <rokdock-checkerboard> custom element.
 *
 * A transparent-background canvas rendered as a CSS checkerboard pattern.
 * Used as a backdrop for image preview areas (e.g., the 9-Patch Editor and
 * SVG Converter) where transparency needs to be visually distinguished from
 * the surrounding UI. Accepts slotted content layered above the pattern.
 */
import { createTemplate } from './base'

const CSS = `
    :host {
        display: block;
        position: relative;
        background: repeating-conic-gradient(
            var(--rokdock-checker-a) 0% 25%,
            var(--rokdock-checker-b) 0% 50%
        ) 0 0 / 14px 14px;
    }
`

const template = createTemplate(CSS, `<slot></slot>`)

class RokdockCheckerboard extends HTMLElement {
    constructor() {
        super()
        const shadow = this.attachShadow({ mode: 'open' })
        shadow.appendChild(template.content.cloneNode(true))
    }
}

customElements.define('rokdock-checkerboard', RokdockCheckerboard)
