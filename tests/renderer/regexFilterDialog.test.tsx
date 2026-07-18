// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import RegexFilterDialog from '@renderer/components/terminal/regexFilterDialog'
import type { MatchOutcome } from '@renderer/components/terminal/regexMatchClient'

beforeEach(() => {
    vi.useFakeTimers()
})
afterEach(() => {
    cleanup()
    vi.useRealTimers()
})

const noop = () => {}

function renderDialog(countMatches: (source: string, flags: string, lines: string[]) => Promise<MatchOutcome<number[]>>) {
    return render(
        <RegexFilterDialog
            open
            title="Save Output"
            description="Save the current terminal output."
            confirmLabel="Save..."
            sampleLines={['alpha', 'beta']}
            countMatches={countMatches}
            onCancel={noop}
            onConfirm={noop}
        />
    )
}

describe('RegexFilterDialog', () => {
    it('shows a live match count from the worker and keeps Confirm enabled', async () => {
        const countMatches = vi.fn(async () => ({ status: 'ok', value: [0] }) as MatchOutcome<number[]>)
        renderDialog(countMatches)
        fireEvent.change(screen.getByLabelText('Filter regex'), { target: { value: 'alpha' } })
        await vi.advanceTimersByTimeAsync(200)

        expect(screen.getByText(/1 of 2 current lines match/)).toBeTruthy()
        expect((screen.getByRole('button', { name: 'Save...' }) as HTMLButtonElement).disabled).toBe(false)
    })

    it('disables Confirm and warns when the pattern is too slow (worker timeout)', async () => {
        const countMatches = vi.fn(async () => ({ status: 'timeout' }) as MatchOutcome<number[]>)
        renderDialog(countMatches)
        fireEvent.change(screen.getByLabelText('Filter regex'), { target: { value: '(a+)+b' } })
        await vi.advanceTimersByTimeAsync(200)

        expect(screen.getByText(/too slow/i)).toBeTruthy()
        expect((screen.getByRole('button', { name: 'Save...' }) as HTMLButtonElement).disabled).toBe(true)
    })

    it('disables Confirm on an invalid pattern without calling the worker', async () => {
        const countMatches = vi.fn(async () => ({ status: 'ok', value: [] }) as MatchOutcome<number[]>)
        renderDialog(countMatches)
        fireEvent.change(screen.getByLabelText('Filter regex'), { target: { value: '(' } })
        await vi.advanceTimersByTimeAsync(200)

        expect(screen.getByText(/Invalid regex/)).toBeTruthy()
        expect((screen.getByRole('button', { name: 'Save...' }) as HTMLButtonElement).disabled).toBe(true)
        expect(countMatches).not.toHaveBeenCalled()
    })
})
