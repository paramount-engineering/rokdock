/**
 * Floating action toolbar shown just above the top of a terminal text selection.
 * Generalizes the former single docs-lookup magnifier: it renders whichever
 * actions are eligible for the current selection.
 *
 *  - "Look up in Docs" appears for a short (1-3 word) term (non-null `term`).
 *  - "Explain this" appears for any non-empty selection when `aiAvailable` is true.
 *
 * Renders nothing when no action is eligible.
 *
 * Icon buttons follow the `.terminal-lookup-hint` inline-style convention from
 * customTerminalView.tsx rather than RokdockIconBtn (a web component). The
 * toolbar is a fixed-positioned overlay built entirely with React/inline styles,
 * which is a better fit than mounting a web component outside the Shadow DOM
 * boundary into a floating layer.
 */
import React from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faMagnifyingGlass, faWandMagicSparkles } from '@fortawesome/free-solid-svg-icons'
import { AI_EXPLAIN_ACTION, withBeta } from '../../shared/ai/labels'

interface Props {
    anchor: { x: number; y: number }
    selection: string
    term: string | null
    aiAvailable: boolean
    onLookup: () => void
    onExplain: () => void
    onClose: () => void
}

export default function TerminalSelectionToolbar({ anchor, selection, term, aiAvailable, onLookup, onExplain }: Props): React.JSX.Element | null {
    const canLookup = term !== null
    const canExplain = aiAvailable && selection.trim().length > 0
    if (!canLookup && !canExplain) return null

    // anchor is the top-left of the selection; sit just above it so the selected text stays visible.
    const top = Math.min(Math.max(anchor.y - 34, 4), window.innerHeight - 34)
    const left = Math.min(Math.max(anchor.x, 4), window.innerWidth - 80)

    return (
        <div
            className="terminal-selection-toolbar"
            style={{
                position: 'fixed',
                zIndex: 50,
                top,
                left,
                display: 'flex',
                gap: 2,
                background: 'var(--rokdock-bg-surface)',
                border: '1px solid var(--rokdock-border-light)',
                borderRadius: 6,
                padding: 2,
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.35)'
            }}
            onMouseDown={(e) => e.preventDefault()}
        >
            {canLookup && (
                <button
                    type="button"
                    data-testid="seltoolbar-lookup"
                    style={buttonStyle}
                    title={`Look up "${term}" in Developer Docs`}
                    aria-label={`Look up "${term}" in Developer Docs`}
                    onClick={onLookup}
                >
                    <FontAwesomeIcon icon={faMagnifyingGlass} />
                </button>
            )}
            {canExplain && (
                <button
                    type="button"
                    data-testid="seltoolbar-explain"
                    style={buttonStyle}
                    title={withBeta(AI_EXPLAIN_ACTION)}
                    aria-label={withBeta(AI_EXPLAIN_ACTION)}
                    onClick={onExplain}
                >
                    <FontAwesomeIcon icon={faWandMagicSparkles} />
                </button>
            )}
        </div>
    )
}

const buttonStyle: React.CSSProperties = {
    width: 24,
    height: 24,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    borderRadius: 4,
    border: 'none',
    color: 'var(--rokdock-text-primary)',
    cursor: 'pointer',
    fontSize: 12
}
