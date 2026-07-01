/**
 * Renders an assistant message as markdown. react-markdown + remark-gfm only.
 * Distinctive Roku symbols are linked to the docs viewer wherever they appear in
 * prose or inline `code`: ro/if-prefixed and interior-hump identifiers link on
 * shape alone (a click runs a docs search), and single-word component names
 * (Rectangle, Label, Poster) link when they are a documented page title (the
 * symbols map). Fenced code blocks are left untouched. A web link the model
 * emits opens in the system browser rather than navigating the app shell.
 */
import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { hasRokuSymbolShape } from '../../../shared/docs/docSymbols'
import { highlightToHtml } from '../../docs/highlight/staticHighlight'

const IDENTIFIER_RE = /[A-Za-z][A-Za-z0-9]*/g
// Stable identity so streaming re-renders do not reinstall the remark pipeline.
const REMARK_PLUGINS = [remarkGfm]

/**
 * A fenced code block with syntax highlighting (shared staticHighlight pipeline,
 * inline-styled with the live theme vars) and a hover Copy button. The button
 * sits on a non-scrolling wrapper so it stays pinned while wide code scrolls.
 */
function ChatCodeBlock({ code, language }: { code: string; language: string }): React.JSX.Element {
    const [copied, setCopied] = React.useState(false)
    const resetTimer = React.useRef<number | null>(null)
    const copy = (): void => {
        navigator.clipboard.writeText(code).then(() => {
            setCopied(true)
            if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
            resetTimer.current = window.setTimeout(() => setCopied(false), 1400)
        }).catch(() => { /* clipboard unavailable or denied: stay idle */ })
    }
    React.useEffect(() => () => { if (resetTimer.current !== null) window.clearTimeout(resetTimer.current) }, [])
    // Re-highlight only when the code or language changes, not on unrelated re-renders.
    const html = React.useMemo(() => highlightToHtml(code, language), [code, language])
    return (
        <div className="ai-chat-code-wrap">
            <button
                type="button"
                className={`ai-chat-code-copy${copied ? ' ai-chat-code-copy--done' : ''}`}
                onClick={copy}
                title={copied ? 'Copied' : 'Copy code'}
                aria-label={copied ? 'Copied' : 'Copy code'}
            >{copied ? 'Copied' : 'Copy'}</button>
            <pre><code dangerouslySetInnerHTML={{ __html: html }} /></pre>
        </div>
    )
}

/** Wrap each linkable symbol token in `text` with a docs-lookup button, keeping the rest as text. */
function linkify(text: string, symbols: Record<string, string>): React.ReactNode {
    const out: React.ReactNode[] = []
    let last = 0
    let match: RegExpExecArray | null
    IDENTIFIER_RE.lastIndex = 0
    while ((match = IDENTIFIER_RE.exec(text)) !== null) {
        const sym = match[0]
        // A single-word component links only when it is a documented title; ro/if and
        // interior-hump identifiers link on shape alone (the lookup runs a docs search).
        if (symbols[sym] === undefined && !hasRokuSymbolShape(sym)) continue
        if (match.index > last) out.push(text.slice(last, match.index))
        out.push(
            <button key={`${sym}-${match.index}`} type="button" className="ai-chat-symbol-link" onClick={() => { void window.rokdock.docs.lookUp(sym) }}>{sym}</button>,
        )
        last = match.index + sym.length
    }
    if (out.length === 0) return text
    if (last < text.length) out.push(text.slice(last))
    return out
}

function mapChildren(children: React.ReactNode, symbols: Record<string, string>): React.ReactNode {
    return React.Children.map(children, child => (typeof child === 'string' ? linkify(child, symbols) : child))
}

export default function ChatMarkdown({ text, symbols = {} }: { text: string; symbols?: Record<string, string> }): React.JSX.Element {
    // Memoize the component overrides per symbols identity. react-markdown remounts
    // every custom-rendered node when the components object changes, so rebuilding it
    // on each streaming token would re-run the highlighter and reset every code
    // block's Copy state. symbols is stable while an answer streams, so this holds.
    const components = React.useMemo(() => {
        const prose = (tag: 'p' | 'li' | 'td' | 'th' | 'strong' | 'em' | 'blockquote' | 'h1' | 'h2' | 'h3' | 'h4') => {
            const Tag = tag
            return ({ children }: { children?: React.ReactNode }) => <Tag>{mapChildren(children, symbols)}</Tag>
        }
        // Inline code may name a symbol, so link it. A fenced block is handled by the
        // pre override, which reads the raw code off this element.
        const code = ({ className, children }: { className?: string; children?: React.ReactNode }): React.JSX.Element => {
            if (typeof children === 'string' && !className) return <code>{mapChildren(children, symbols)}</code>
            return <code className={className}>{children}</code>
        }
        // A fenced block renders as a highlighted, copyable code block. react-markdown
        // hands pre its rendered <code> child, so read the raw text and language-* class
        // off it. The text is normally one string; flatten an array form just in case.
        const pre = ({ children }: { children?: React.ReactNode }): React.JSX.Element => {
            const codeEl = React.isValidElement(children) ? (children as React.ReactElement<{ className?: string; children?: React.ReactNode }>) : null
            if (!codeEl) return <pre>{children}</pre>
            const language = /language-(\S+)/.exec(codeEl.props.className ?? '')?.[1] ?? ''
            const raw = codeEl.props.children
            const codeText = (Array.isArray(raw) ? raw.join('') : String(raw ?? '')).replace(/\n$/, '')
            return <ChatCodeBlock code={codeText} language={language} />
        }
        // A link in an answer must open in the system browser. Navigating the renderer
        // would replace the whole app shell with the target page. (The main-process guard
        // is the backstop. This is the intended in-app behavior.)
        const anchor = ({ href, children }: { href?: string; children?: React.ReactNode }): React.JSX.Element => (
            <a
                href={href}
                onClick={(event) => {
                    event.preventDefault()
                    if (href) void window.rokdock.external.openUrl(href)
                }}
            >{children}</a>
        )
        return {
            a: anchor, code, pre,
            p: prose('p'), li: prose('li'), td: prose('td'), th: prose('th'),
            strong: prose('strong'), em: prose('em'), blockquote: prose('blockquote'),
            h1: prose('h1'), h2: prose('h2'), h3: prose('h3'), h4: prose('h4'),
        }
    }, [symbols])
    return (
        <div className="ai-chat-markdown">
            <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>{text}</ReactMarkdown>
        </div>
    )
}
