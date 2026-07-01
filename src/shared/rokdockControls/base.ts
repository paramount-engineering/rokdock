/**
 * Base helper for RokDock Web Components.
 * Provides a consistent pattern for creating Shadow DOM components
 * with CSS that inherits --rokdock-* tokens from the host document.
 */

/** Common CSS that all components inherit */
export const COMMON_CSS = `
    :host {
        font-family: var(--rokdock-font-ui);
        color: var(--rokdock-text-primary);
        box-sizing: border-box;
    }
    :host([hidden]) { display: none; }
    *, *::before, *::after { box-sizing: border-box; }
`

/**
 * Create a template element with Shadow DOM-ready HTML.
 * The css parameter is concatenated with COMMON_CSS.
 */
export function createTemplate(css: string, html: string): HTMLTemplateElement {
    const template = document.createElement('template')
    template.innerHTML = `<style>${COMMON_CSS}\n${css}</style>\n${html}`
    return template
}

/**
 * Dispatch a custom event from a component.
 * Events bubble and are composed (cross shadow boundary).
 */
export function emitEvent(element: HTMLElement, name: string, detail?: unknown): void {
    element.dispatchEvent(new CustomEvent(name, {
        bubbles: true,
        composed: true,
        detail,
    }))
}

/**
 * Clamp a raw numeric value into [min, max], substituting min for NaN.
 * Shared by the numeric input components (number input, pill input, slider).
 */
export function clampToRange(raw: number, min: number, max: number): number {
    const val = isNaN(raw) ? min : raw
    return Math.max(min, Math.min(max, val))
}
