/**
 * Prompt shown before the terminal Save-output and Stream-to-file actions.
 *
 * Lets the user enter an optional regular expression that filters which lines get
 * written. An empty pattern writes every line (the prior behavior). The pattern is
 * validated live: an invalid regex shows an error and disables the confirm button.
 * When a `countMatches` runner and sample lines are provided, a running
 * "N of M lines match" count is computed IN THE REGEX WORKER, so a
 * catastrophic-backtracking pattern cannot freeze the dialog: it surfaces
 * "pattern too slow" and disables confirm instead of hanging.
 *
 * Built on ConfirmDialog so it inherits the shared dialog chrome, close button, and
 * backdrop/escape handling; this component only adds the input and its feedback row.
 */

import React, { useEffect, useMemo, useState } from 'react'
import ConfirmDialog from '../common/confirmDialog'
import { compileLineFilter } from '../../../shared/lineFilter'
import type { MatchOutcome } from './regexMatchClient'

interface RegexFilterDialogProps {
    open: boolean
    title: string
    description: string
    confirmLabel: string
    /** Current buffer line texts, used to preview a live match count. */
    sampleLines?: string[]
    /** Worker-backed matcher for the live count. Omitted in contexts without a client. */
    countMatches?: (source: string, flags: string, lines: string[]) => Promise<MatchOutcome<number[]>>
    onCancel: () => void
    /** Called with the compiled filter (null for an empty pattern = every line). */
    onConfirm: (regex: RegExp | null) => void
}

type CountState =
    | { status: 'idle' }
    | { status: 'computing' }
    | { status: 'done'; count: number }
    | { status: 'tooSlow' }

/**
 * Renders the optional-regex prompt. Confirm is disabled while the pattern is an
 * invalid regex or the preview timed out; pressing Enter confirms when allowed.
 */
export default function RegexFilterDialog({
    open,
    title,
    description,
    confirmLabel,
    sampleLines,
    countMatches,
    onCancel,
    onConfirm
}: RegexFilterDialogProps) {
    const [pattern, setPattern] = useState('')

    // Reset the pattern each time the prompt opens.
    useEffect(() => {
        if (open) setPattern('')
    }, [open])

    const { regex, error } = useMemo(() => compileLineFilter(pattern), [pattern])

    // The live match count runs in the regex worker (debounced). The previous count stays
    // visible while a new one computes; a timed-out pattern reports tooSlow and blocks confirm.
    const [countState, setCountState] = useState<CountState>({ status: 'idle' })
    useEffect(() => {
        if (error || !regex || !sampleLines || !countMatches) { setCountState({ status: 'idle' }); return }
        let cancelled = false
        setCountState({ status: 'computing' })
        const debounce = setTimeout(() => {
            void countMatches(regex.source, regex.flags, sampleLines).then((outcome) => {
                if (cancelled) return
                if (outcome.status === 'ok') setCountState({ status: 'done', count: outcome.value.length })
                else if (outcome.status === 'timeout') setCountState({ status: 'tooSlow' })
                // 'invalid' is already covered by `error`; 'superseded' means a newer run will set state.
            })
        }, 150)
        return () => { cancelled = true; clearTimeout(debounce) }
    }, [error, regex, sampleLines, countMatches])

    const confirmDisabled = !!error || countState.status === 'tooSlow'
    const confirm = () => {
        if (!confirmDisabled) onConfirm(regex)
    }

    return (
        <ConfirmDialog
            open={open}
            title={title}
            message={description}
            confirmLabel={confirmLabel}
            confirmDisabled={confirmDisabled}
            onConfirm={confirm}
            onCancel={onCancel}
        >
            <input
                className="rokdock-input"
                style={{ fontFamily: 'var(--rokdock-font-mono)', fontSize: 'var(--rokdock-font-xs)' }}
                autoFocus
                placeholder="Filter regex (empty = all lines)"
                aria-label="Filter regex"
                aria-invalid={!!error}
                value={pattern}
                onChange={(event) => setPattern(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') { event.preventDefault(); confirm() }
                }}
            />
            <div style={{ minHeight: 16, fontSize: 'var(--rokdock-font-xs)' }}>
                {error
                    ? <span style={{ color: 'var(--rokdock-error-text)' }}>Invalid regex: {error}</span>
                    : countState.status === 'tooSlow'
                        ? <span style={{ color: 'var(--rokdock-error-text)' }}>Pattern too slow to preview. Try a simpler filter.</span>
                        : countState.status === 'done'
                            ? <span style={{ color: 'var(--rokdock-text-muted)' }}>{countState.count} of {sampleLines?.length ?? 0} current lines match</span>
                            : countState.status === 'computing'
                                ? <span style={{ color: 'var(--rokdock-text-muted)' }}>Counting matches...</span>
                                : <span style={{ color: 'var(--rokdock-text-muted)' }}>Leave empty to include every line.</span>}
            </div>
        </ConfirmDialog>
    )
}
