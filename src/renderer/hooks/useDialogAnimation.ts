/**
 * Hook that provides a one-frame delayed visibility flag for CSS enter animations.
 *
 * When a dialog opens (open transitions to true), the visible flag starts false
 * and becomes true one animation frame later. This allows the dialog to be in the
 * DOM with its initial (hidden/scaled-down) CSS state before the transition class
 * is applied, making CSS transitions play on mount instead of snapping to end state.
 *
 * Usage: apply the CSS transition class when `visible` is true, not when `open` is true.
 */

import { useEffect, useState } from 'react'

/**
 * Returns a visibility flag that trails `open` by one animation frame.
 * Use the returned boolean to gate CSS transition classes so enter animations
 * play from their initial state rather than snapping to the end state on mount.
 *
 * @param open - Whether the dialog is logically open.
 * @returns `true` one rAF after `open` becomes true; resets to `false` immediately when `open` becomes false.
 */
export function useDialogAnimation(open: boolean): boolean {
    const [visible, setVisible] = useState(false)

    useEffect(() => {
        if (!open) {
            setVisible(false)
            return
        }
        const id = requestAnimationFrame(() => setVisible(true))
        return () => cancelAnimationFrame(id)
    }, [open])

    return visible
}
