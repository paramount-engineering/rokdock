import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppPreferences } from '@shared/types'

/**
 * Reading-pane text zoom: a multiplier on the docs prose font size, adjusted
 * with Ctrl+=/Ctrl+-/Ctrl+0 and persisted to AppPreferences.docsReadingScale.
 * This scales only the reading content (the `.docs-prose` font size, which
 * every heading/code size is relative to), not the window chrome.
 */
export const READING_SCALE_MIN = 0.8
export const READING_SCALE_MAX = 1.8
export const READING_SCALE_STEP = 0.1
export const READING_SCALE_DEFAULT = 1

/** Clamp to the allowed range and round to one decimal (avoids float drift). */
export function clampReadingScale(scale: number): number {
    const rounded = Math.round(scale * 10) / 10
    return Math.min(READING_SCALE_MAX, Math.max(READING_SCALE_MIN, rounded))
}

/** Step the scale one increment up (+1) or down (-1), clamped. */
export function stepReadingScale(scale: number, direction: 1 | -1): number {
    return clampReadingScale(scale + direction * READING_SCALE_STEP)
}

export interface ReadingZoomHook {
    /** Current reading scale multiplier (1 = default). */
    scale: number
    increase: () => void
    decrease: () => void
    reset: () => void
}

export function useReadingZoom(): ReadingZoomHook {
    const [scale, setScale] = useState(READING_SCALE_DEFAULT)
    // Skip persisting on mount and on the initial load below: only a user-driven
    // change should write back.
    const persistReady = useRef(false)

    useEffect(() => {
        void window.rokdock.store.getPreferences().then((preferences: AppPreferences) => {
            if (Number.isFinite(preferences.docsReadingScale)) {
                setScale(clampReadingScale(preferences.docsReadingScale as number))
            }
            persistReady.current = true
        })
    }, [])

    // Persist the scale as it changes, outside the state updater so the updater
    // stays pure (no doubled IPC under StrictMode's double-invocation).
    useEffect(() => {
        if (!persistReady.current) return
        void window.rokdock.store.setPreferences({ docsReadingScale: scale })
    }, [scale])

    const increase = useCallback(() => setScale(current => stepReadingScale(current, 1)), [])
    const decrease = useCallback(() => setScale(current => stepReadingScale(current, -1)), [])
    const reset = useCallback(() => setScale(READING_SCALE_DEFAULT), [])

    return { scale, increase, decrease, reset }
}
