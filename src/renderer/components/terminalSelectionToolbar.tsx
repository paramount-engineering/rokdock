/**
 * Floating action toolbar shown just above the top of a terminal text selection.
 * Generalizes the former single docs-lookup magnifier: it renders whichever
 * actions are eligible for the current selection.
 *
 *  - "Copy" appears for any non-empty selection.
 *  - "Look up in Docs" appears for a short (1-3 word) term (non-null `term`).
 *  - "Ask roBot" appears for any non-empty selection when `aiAvailable` is true.
 *
 * Renders nothing when no action is eligible. The caller (customTerminalView) also
 * mounts and unmounts this component based on pointer hover over the selection/toolbar,
 * so its own visibility here is purely about which ACTIONS apply, not whether it is
 * currently being shown at all.
 *
 * Icon buttons follow the `.terminal-lookup-hint` inline-style convention from
 * customTerminalView.tsx rather than RokdockIconBtn (a web component). The
 * toolbar is a fixed-positioned overlay built entirely with React/inline styles,
 * which is a better fit than mounting a web component outside the Shadow DOM
 * boundary into a floating layer.
 */
import React from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCopy, faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons'
import { roBot } from './ai/roBotMark'
import { AI_EXPLAIN_ACTION, withBeta } from '../../shared/ai/labels'

interface Props {
    /** Attached to the root element so a caller can hit-test the toolbar's own live rect
     *  (e.g. to keep it visible while the pointer crosses the gap to reach a button). */
    rootRef?: React.Ref<HTMLDivElement>
    anchor: { x: number; y: number }
    selection: string
    term: string | null
    aiAvailable: boolean
    onCopy: () => void
    onLookup: () => void
    onExplain: () => void
    onClose: () => void
}

export default function TerminalSelectionToolbar({ rootRef, anchor, selection, term, aiAvailable, onCopy, onLookup, onExplain }: Props): React.JSX.Element | null {
    const canCopy = selection.trim().length > 0
    const canLookup = term !== null
    const canExplain = aiAvailable && selection.trim().length > 0
    if (!canCopy && !canLookup && !canExplain) return null

    // anchor is the top-left of the selection; sit just above it so the selected text stays visible.
    const top = Math.min(Math.max(anchor.y - 34, 4), window.innerHeight - 34)
    const left = Math.min(Math.max(anchor.x, 4), window.innerWidth - 80)

    return (
        <div
            ref={rootRef}
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
            {canCopy && (
                <button
                    type="button"
                    data-testid="seltoolbar-copy"
                    style={buttonStyle}
                    title="Copy"
                    aria-label="Copy selection"
                    onClick={onCopy}
                >
                    <FontAwesomeIcon icon={faCopy} />
                </button>
            )}
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
                    <roBot.Glyph size={20} />
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
