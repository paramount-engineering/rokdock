import { useEffect, useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'

/**
 * Per-page reading-position memory for the docs reading pane, scoped to the
 * current session (the open window's navigation history): returning to a page
 * restores the scroll offset you left it at. Held in memory only, so it resets
 * when the docs window is closed and is never written to disk.
 */
// Coalesce scroll bursts so the transient clamp a short new page triggers while
// navigating is not saved; the timer fires once scrolling settles and records
// the live offset under the page that is current at that moment.
const SAVE_DEBOUNCE_MS = 150

export function useReadingPosition(
    bodyRef: RefObject<HTMLElement | null>,
    pagePath: string | null,
): void {
    const positions = useRef<Record<string, number>>({})
    const currentPath = useRef<string | null>(null)
    const saveTimer = useRef<number | null>(null)

    // Restore on page change, before paint (no scroll flash). The current path is
    // updated synchronously here so the debounced save records under the page in
    // view. Only a page seen earlier this session is restored; a first visit is
    // left where it is.
    useLayoutEffect(() => {
        currentPath.current = pagePath
        const body = bodyRef.current
        if (!body || !pagePath) return
        const saved = positions.current[pagePath]
        if (saved === undefined) return
        // Heavy content (images, wide tables) can grow the body's height across
        // a few frames after commit. Setting scrollTop before the body is tall
        // enough clamps it short, landing the reader above where they left off,
        // so retry until the offset sticks or the content stops growing.
        let frame = 0
        let raf = 0
        const restore = (): void => {
            body.scrollTop = saved
            frame += 1
            if (body.scrollTop < saved && frame < 12) {
                raf = window.requestAnimationFrame(restore)
            }
        }
        restore()
        return () => { if (raf) window.cancelAnimationFrame(raf) }
    }, [pagePath, bodyRef])

    // Remember the offset on scroll (in memory only), debounced so navigation
    // clamps do not overwrite a page's real position.
    useEffect(() => {
        const body = bodyRef.current
        if (!body) return
        const onScroll = (): void => {
            if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
            saveTimer.current = window.setTimeout(() => {
                const path = currentPath.current
                if (path) positions.current[path] = body.scrollTop
            }, SAVE_DEBOUNCE_MS)
        }
        body.addEventListener('scroll', onScroll, { passive: true })
        return () => {
            body.removeEventListener('scroll', onScroll)
            if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
        }
    }, [bodyRef])
}
