import React from 'react'

export function DocsNote({
    value,
    onChange,
    onClose,
}: {
    value: string
    onChange: (text: string) => void
    onClose: () => void
}): React.JSX.Element {
    return (
        <div className="docs-note" role="group" aria-label="Page notes">
            <div className="docs-note-paper" aria-hidden="true" />
            <button
                type="button"
                className="docs-note-close"
                onClick={onClose}
                aria-label="Hide notes"
            >
                <svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                    <line x1="1" y1="1" x2="9" y2="9" />
                    <line x1="9" y1="1" x2="1" y2="9" />
                </svg>
            </button>
            <textarea
                className="docs-note-text"
                placeholder="Your notes for this page..."
                value={value}
                onChange={e => onChange(e.target.value)}
                aria-label="Page notes"
            />
        </div>
    )
}
