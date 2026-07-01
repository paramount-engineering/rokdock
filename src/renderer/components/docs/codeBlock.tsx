import React, { useCallback, useEffect, useRef, useState } from 'react'
import { highlightToHtml } from '../../docs/highlight/staticHighlight'

interface CodeBlockProps {
    language: string
    code: string
}

/** Clipboard glyph (idle copy state). */
function CopyGlyph(): React.JSX.Element {
    return (
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="5.5" y="5.5" width="8.5" height="8.5" rx="1.5" />
            <path d="M3.5 10.5H3A1.5 1.5 0 0 1 1.5 9V3A1.5 1.5 0 0 1 3 1.5h6A1.5 1.5 0 0 1 10.5 3v.5" />
        </svg>
    )
}

/** Check glyph (copied confirmation state). */
function CheckGlyph(): React.JSX.Element {
    return (
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 8.5 6.5 12 13 4.5" />
        </svg>
    )
}

/**
 * A fenced code block with a hover "Copy" affordance. The button lives on a
 * non-scrolling wrapper (not inside the horizontally-scrolling <pre>) so it
 * stays pinned to the top-right while wide code scrolls underneath.
 *
 * highlightToHtml handles both known and unknown languages: for unknown
 * languages it returns HTML-escaped plain text (no spans), so the
 * dangerouslySetInnerHTML is safe in both cases.
 */
export function CodeBlock({ language, code }: CodeBlockProps): React.JSX.Element {
    const [copied, setCopied] = useState(false)
    const resetTimer = useRef<number | null>(null)

    const copy = useCallback(() => {
        navigator.clipboard.writeText(code).then(() => {
            setCopied(true)
            if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
            resetTimer.current = window.setTimeout(() => setCopied(false), 1400)
        }).catch(() => {
            // Clipboard unavailable or denied: leave the button in its idle state.
        })
    }, [code])

    useEffect(() => () => {
        if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
    }, [])

    return (
        <div className="docs-code-wrap">
            <button
                type="button"
                className={`docs-code-copy${copied ? ' docs-code-copy--done' : ''}`}
                onClick={copy}
                title={copied ? 'Copied' : 'Copy code'}
                aria-label={copied ? 'Copied' : 'Copy code'}
            >
                {copied ? <CheckGlyph /> : <CopyGlyph />}
                <span className="docs-code-copy-label">{copied ? 'Copied' : 'Copy'}</span>
            </button>
            <pre className="docs-code">
                <code dangerouslySetInnerHTML={{ __html: highlightToHtml(code, language) }} />
            </pre>
        </div>
    )
}
