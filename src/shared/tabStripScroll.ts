/**
 * Caret-based horizontal scrolling for a tab strip, shared by the terminal tab bar
 * (React) and the tool-window tab bars (vanilla, for example the JSON editor).
 *
 * Given the scrollable list element and its two caret buttons, it:
 *  - shows the carets only when the strip overflows its width,
 *  - disables the caret at whichever end the strip is already against,
 *  - scrolls by roughly a page per caret click (smooth),
 *  - scrolls the strip with a vertical mouse wheel (the caret model keeps wheel scrolling),
 *  - keeps the caret state current on scroll, on resize, and on content change (via refresh).
 *
 * The caller owns the button markup and icon, so this stays framework-agnostic and
 * icon-agnostic. It touches the DOM, so it is renderer-only (never imported by main).
 */

/** A wired tab-strip scroller. Call refresh after the tab set changes; dispose to tear down. */
export interface TabStripScroller {
    /** Recompute caret visibility and enabled state (call after tabs are added or removed). */
    refresh(): void
    /** Remove every listener and observer this scroller registered. */
    dispose(): void
}

/** Smallest caret step, so a very narrow strip still advances a useful amount. */
const MIN_STEP_PX = 80
/** Fraction of the visible width a single caret click scrolls. */
const PAGE_RATIO = 0.8
/** Slack (px) so sub-pixel rounding does not leave a caret falsely enabled at an end. */
const END_EPSILON = 1
/** Class placed on the list while a wheel is scrolling it, to suppress a stale :hover. */
const WHEELING_CLASS = 'rokdock-tab-list-wheeling'

/**
 * Wires caret + wheel scrolling onto a tab strip.
 *
 * @param list - The scrollable tab-list element (overflow-x with the native scrollbar hidden).
 * @param leftCaret - The scroll-left button, flanking the list on its left.
 * @param rightCaret - The scroll-right button, flanking the list on its right.
 */
export function createTabStripScroller(
    list: HTMLElement,
    leftCaret: HTMLButtonElement,
    rightCaret: HTMLButtonElement
): TabStripScroller {
    const stepSize = (): number => Math.max(MIN_STEP_PX, Math.round(list.clientWidth * PAGE_RATIO))
    const maxScrollLeft = (): number => list.scrollWidth - list.clientWidth

    const refresh = (): void => {
        const overflowing = maxScrollLeft() > END_EPSILON
        leftCaret.hidden = !overflowing
        rightCaret.hidden = !overflowing
        leftCaret.disabled = list.scrollLeft <= END_EPSILON
        rightCaret.disabled = list.scrollLeft >= maxScrollLeft() - END_EPSILON
    }

    const scrollByStep = (direction: number): void => {
        list.scrollBy({ left: direction * stepSize(), behavior: 'smooth' })
    }
    const onLeftClick = (): void => scrollByStep(-1)
    const onRightClick = (): void => scrollByStep(1)
    const onWheel = (event: WheelEvent): void => {
        // A vertical wheel scrolls the horizontal strip. A real horizontal wheel passes through.
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
        event.preventDefault()
        // Programmatic scroll does not make the browser recompute :hover, so the tab under
        // the (stationary) cursor stays highlighted. Suppress hover until the next real
        // pointer move restores it, keeping the highlight on the tab actually under the cursor.
        list.classList.add(WHEELING_CLASS)
        list.scrollLeft += event.deltaY
        refresh()
    }
    const onScroll = (): void => refresh()
    const onPointerMove = (): void => list.classList.remove(WHEELING_CLASS)

    leftCaret.addEventListener('click', onLeftClick)
    rightCaret.addEventListener('click', onRightClick)
    list.addEventListener('wheel', onWheel, { passive: false })
    list.addEventListener('scroll', onScroll, { passive: true })
    list.addEventListener('pointermove', onPointerMove, { passive: true })
    const resizeObserver = new ResizeObserver(refresh)
    resizeObserver.observe(list)

    refresh()

    return {
        refresh,
        dispose(): void {
            leftCaret.removeEventListener('click', onLeftClick)
            rightCaret.removeEventListener('click', onRightClick)
            list.removeEventListener('wheel', onWheel)
            list.removeEventListener('scroll', onScroll)
            list.removeEventListener('pointermove', onPointerMove)
            list.classList.remove(WHEELING_CLASS)
            resizeObserver.disconnect()
        }
    }
}
