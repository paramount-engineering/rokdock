// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import TerminalSelectionToolbar from '@renderer/components/terminalSelectionToolbar'

afterEach(() => {
    cleanup()
})

const anchor = { x: 100, y: 100 }

describe('TerminalSelectionToolbar', () => {
    it('shows copy, lookup, and explain for a short selection when AI is available', () => {
        const { queryByTestId } = render(
            <TerminalSelectionToolbar anchor={anchor} selection="roSGScreen" term="roSGScreen" aiAvailable={true}
                onCopy={vi.fn()} onLookup={vi.fn()} onExplain={vi.fn()} onClose={vi.fn()} />)
        expect(queryByTestId('seltoolbar-copy')).not.toBeNull()
        expect(queryByTestId('seltoolbar-lookup')).not.toBeNull()
        expect(queryByTestId('seltoolbar-explain')).not.toBeNull()
    })

    it('shows copy and Explain, but not Lookup, for a multi-line selection', () => {
        const { queryByTestId } = render(
            <TerminalSelectionToolbar anchor={anchor} selection={'line1\nline2\nline3'} term={null} aiAvailable={true}
                onCopy={vi.fn()} onLookup={vi.fn()} onExplain={vi.fn()} onClose={vi.fn()} />)
        expect(queryByTestId('seltoolbar-copy')).not.toBeNull()
        expect(queryByTestId('seltoolbar-lookup')).toBeNull()
        expect(queryByTestId('seltoolbar-explain')).not.toBeNull()
    })

    it('shows copy and lookup, but not Explain, when AI is not available', () => {
        const { queryByTestId } = render(
            <TerminalSelectionToolbar anchor={anchor} selection="roSGScreen" term="roSGScreen" aiAvailable={false}
                onCopy={vi.fn()} onLookup={vi.fn()} onExplain={vi.fn()} onClose={vi.fn()} />)
        expect(queryByTestId('seltoolbar-copy')).not.toBeNull()
        expect(queryByTestId('seltoolbar-explain')).toBeNull()
        expect(queryByTestId('seltoolbar-lookup')).not.toBeNull()
    })

    it('still shows Copy even when neither Lookup nor Explain is eligible', () => {
        const { queryByTestId } = render(
            <TerminalSelectionToolbar anchor={anchor} selection={'long text'} term={null} aiAvailable={false}
                onCopy={vi.fn()} onLookup={vi.fn()} onExplain={vi.fn()} onClose={vi.fn()} />)
        expect(queryByTestId('seltoolbar-copy')).not.toBeNull()
        expect(queryByTestId('seltoolbar-lookup')).toBeNull()
        expect(queryByTestId('seltoolbar-explain')).toBeNull()
    })

    it('renders nothing for an empty/whitespace-only selection', () => {
        const { container } = render(
            <TerminalSelectionToolbar anchor={anchor} selection={'   '} term={null} aiAvailable={true}
                onCopy={vi.fn()} onLookup={vi.fn()} onExplain={vi.fn()} onClose={vi.fn()} />)
        expect(container.firstChild).toBeNull()
    })

    it('invokes callbacks on click', () => {
        const onCopy = vi.fn()
        const onExplain = vi.fn()
        const { getByTestId } = render(
            <TerminalSelectionToolbar anchor={anchor} selection="stack trace" term={null} aiAvailable={true}
                onCopy={onCopy} onLookup={vi.fn()} onExplain={onExplain} onClose={vi.fn()} />)
        getByTestId('seltoolbar-copy').click()
        expect(onCopy).toHaveBeenCalled()
        getByTestId('seltoolbar-explain').click()
        expect(onExplain).toHaveBeenCalled()
    })
})
