/**
 * Application zoom level helpers for the main renderer window.
 *
 * Electron's webContents.setZoomLevel() operates on a logarithmic scale.
 * These helpers clamp the level to a sane [-3, 5] range, apply it via
 * window.rokdock.zoom.setLevel(), sync appStore, and persist it to settings.
 *
 * Exports:
 *  - setAppZoomLevel(level): set an absolute zoom level.
 *  - stepAppZoom(delta): increment or decrement the current level by delta
 *    (e.g., +1 or -1 for keyboard shortcuts).
 */
import { useAppStore } from '../store/appStore'

const MIN_ZOOM_LEVEL = -3
const MAX_ZOOM_LEVEL = 5

/** Clamp `level` to the valid Electron zoom range [MIN_ZOOM_LEVEL, MAX_ZOOM_LEVEL]. */
function clampZoomLevel(level: number): number {
    return Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, level))
}

/** Persist `level` to user preferences via IPC, logging any failure without throwing. */
function persistZoomLevel(level: number): void {
    void window.rokdock.store.setPreferences({ appZoomLevel: level }).catch((err: unknown) => {
        console.error('Failed to persist app zoom level:', err)
    })
}

/**
 * Set the application zoom to an absolute level, clamping to [MIN_ZOOM_LEVEL, MAX_ZOOM_LEVEL].
 * Applies the level via the Electron IPC bridge, syncs appStore, and persists to preferences.
 *
 * @param level - Target Electron zoom level (0 = 100%, 1 = ~120%, -1 = ~83%).
 * @returns The clamped level that was applied.
 */
export function setAppZoomLevel(level: number): number {
    const next = clampZoomLevel(level)
    window.rokdock.zoom.setLevel(next)
    useAppStore.setState({ appZoomLevel: next })
    persistZoomLevel(next)
    return next
}

/**
 * Increment or decrement the current zoom level by `delta` steps.
 * Reads the live zoom level from the Electron bridge so it stays in sync
 * even if another code path has changed it since the last store update.
 *
 * @param delta - Amount to add to the current level (e.g. +1 or -1).
 * @returns The clamped level that was applied.
 */
export function stepAppZoom(delta: number): number {
    const current = window.rokdock.zoom.getLevel()
    return setAppZoomLevel(current + delta)
}

