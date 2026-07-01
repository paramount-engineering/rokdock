// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import TerminalSelectionToolbar from '@renderer/components/terminalSelectionToolbar'

afterEach(() => {
    cleanup()
})

const anchor = { x: 100, y: 100 }

describe('TerminalSelectionToolbar', () => {
    it('shows both actions for a short selection when AI is available', () => {
        const { queryByTestId } = render(
            <TerminalSelectionToolbar anchor={anchor} selection="roSGScreen" term="roSGScreen" aiAvailable={true}
                onLookup={vi.fn()} onExplain={vi.fn()} onClose={vi.fn()} />)
        expect(queryByTestId('seltoolbar-lookup')).not.toBeNull()
        expect(queryByTestId('seltoolbar-explain')).not.toBeNull()
    })

    it('shows only Explain for a multi-line selection', () => {
        const { queryByTestId } = render(
            <TerminalSelectionToolbar anchor={anchor} selection={'line1\nline2\nline3'} term={null} aiAvailable={true}
                onLookup={vi.fn()} onExplain={vi.fn()} onClose={vi.fn()} />)
        expect(queryByTestId('seltoolbar-lookup')).toBeNull()
        expect(queryByTestId('seltoolbar-explain')).not.toBeNull()
    })

    it('shows only lookup when AI is not available', () => {
        const { queryByTestId } = render(
            <TerminalSelectionToolbar anchor={anchor} selection="roSGScreen" term="roSGScreen" aiAvailable={false}
                onLookup={vi.fn()} onExplain={vi.fn()} onClose={vi.fn()} />)
        expect(queryByTestId('seltoolbar-explain')).toBeNull()
        expect(queryByTestId('seltoolbar-lookup')).not.toBeNull()
    })

    it('renders nothing when no action is eligible', () => {
        const { container } = render(
            <TerminalSelectionToolbar anchor={anchor} selection={'long text'} term={null} aiAvailable={false}
                onLookup={vi.fn()} onExplain={vi.fn()} onClose={vi.fn()} />)
        expect(container.firstChild).toBeNull()
    })

    it('invokes callbacks on click', () => {
        const onExplain = vi.fn()
        const { getByTestId } = render(
            <TerminalSelectionToolbar anchor={anchor} selection="stack trace" term={null} aiAvailable={true}
                onLookup={vi.fn()} onExplain={onExplain} onClose={vi.fn()} />)
        getByTestId('seltoolbar-explain').click()
        expect(onExplain).toHaveBeenCalled()
    })
})
