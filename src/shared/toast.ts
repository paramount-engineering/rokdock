/**
 * Transient toast helper for bundled tool-window entries.
 *
 * Binds a show function to a toast element: it sets the message, adds the `show`
 * class, and removes it after `durationMs`, resetting the timer on each call.
 * Empty messages are ignored. Returns a closure that captures only the element
 * and its own timer, so it does not pin any larger scope alive.
 */
export function createToast(element: HTMLElement, durationMs = 2400): (message: string) => void {
    let timer: ReturnType<typeof setTimeout> | null = null
    return (message: string) => {
        if (!message) return
        element.textContent = message
        element.classList.add('show')
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => element.classList.remove('show'), durationMs)
    }
}
