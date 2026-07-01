/**
 * Window positioning helpers for tool windows.
 *
 * Used when opening secondary windows (JSON editor, 9-patch editor, etc.) to
 * center them over the parent window while keeping them within the screen's
 * visible work area.
 */

import { BrowserWindow, screen } from 'electron'

/** Compute x/y to center a new window of the given size over the parent window,
 *  clamped to the nearest display's work area. Returns undefined if no parent. */
export function centeredBounds(
    parent: BrowserWindow | null | undefined,
    width: number,
    height: number
): { x: number; y: number } | undefined {
    if (!parent) return undefined
    const bounds = parent.getBounds()
    const display = screen.getDisplayNearestPoint({
        x: Math.round(bounds.x + bounds.width / 2),
        y: Math.round(bounds.y + bounds.height / 2)
    })
    const area = display.workArea
    return {
        x: Math.max(area.x, Math.min(area.x + area.width - width, Math.round(bounds.x + (bounds.width - width) / 2))),
        y: Math.max(area.y, Math.min(area.y + area.height - height, Math.round(bounds.y + (bounds.height - height) / 2)))
    }
}
