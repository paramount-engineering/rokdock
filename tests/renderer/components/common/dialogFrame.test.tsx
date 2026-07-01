// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import DialogFrame from '@renderer/components/common/dialogFrame'

afterEach(cleanup)

function setup() {
    const onClose = vi.fn()
    const { container, getByTestId } = render(
        <DialogFrame open onClose={onClose}>
            <button data-testid="dialog-content">inside</button>
        </DialogFrame>,
    )
    const overlay = container.querySelector('.rokdock-overlay') as HTMLElement
    const content = getByTestId('dialog-content')
    return { onClose, overlay, content }
}

describe('DialogFrame backdrop dismissal', () => {
    it('closes on a genuine backdrop click (press and release both on the backdrop)', () => {
        const { onClose, overlay } = setup()
        fireEvent.mouseDown(overlay)
        fireEvent.mouseUp(overlay)
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('does NOT close when a drag starts inside the dialog and releases on the backdrop', () => {
        const { onClose, overlay, content } = setup()
        // Text-selection drag: press inside the dialog, release on the backdrop.
        fireEvent.mouseDown(content)
        fireEvent.mouseUp(overlay)
        expect(onClose).not.toHaveBeenCalled()
    })

    it('does NOT close when a drag starts on the backdrop and releases inside the dialog', () => {
        const { onClose, overlay, content } = setup()
        fireEvent.mouseDown(overlay)
        fireEvent.mouseUp(content)
        expect(onClose).not.toHaveBeenCalled()
    })

    it('does NOT close on a press-and-release entirely inside the dialog', () => {
        const { onClose, content } = setup()
        fireEvent.mouseDown(content)
        fireEvent.mouseUp(content)
        expect(onClose).not.toHaveBeenCalled()
    })

    it('closes on Escape', () => {
        const { onClose, overlay } = setup()
        fireEvent.keyDown(overlay, { key: 'Escape' })
        expect(onClose).toHaveBeenCalledTimes(1)
    })
})
