// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import UpdatesDialog from '@renderer/components/updatesDialog'

beforeEach(() => {
    ;(window as unknown as { rokdock: unknown }).rokdock = {
        updates: { onDownloadProgress: vi.fn(() => () => {}) },
    }
})
afterEach(() => cleanup())

const noop = () => {}

describe('UpdatesDialog', () => {
    it('renders the release-notes HTML as real elements, not raw tags', () => {
        render(
            <UpdatesDialog
                result={{ status: 'available', version: '1.6.0', notes: '<h2>Highlights</h2><ul><li>First thing</li></ul>' }}
                onClose={noop}
                onRetry={noop}
            />
        )
        expect(screen.getByRole('heading', { name: 'Highlights' })).toBeTruthy()
        expect(screen.getByText('First thing').tagName).toBe('LI')
        // The literal tag source must not leak through as text.
        expect(screen.queryByText(/<h2>Highlights<\/h2>/)).toBeNull()
    })

    it('sanitizes unsafe markup in the notes', () => {
        render(
            <UpdatesDialog
                result={{ status: 'available', notes: '<p>safe note</p><script>(window).__pwned = 1</script>' }}
                onClose={noop}
                onRetry={noop}
            />
        )
        expect(screen.getByText('safe note')).toBeTruthy()
        expect(document.querySelector('script')).toBeNull()
        expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined()
    })

    it('shows a friendly, non-technical message on a check error', () => {
        render(<UpdatesDialog result={{ status: 'error' }} onClose={noop} onRetry={noop} />)
        expect(screen.getByText('Could not check for updates. Please try again later.')).toBeTruthy()
    })
})
