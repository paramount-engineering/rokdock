/**
 * The AI Chat (Beta) panel: a general-purpose, multi-turn assistant docked in the
 * left column. Drives the store's chat slice. Streams replies into a live bubble.
 */
import React, { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../store/appStore'
import ChatMarkdown from './chatMarkdown'
import { AI_CHAT_TITLE, withBeta } from '../../../shared/ai/labels'
import type { DocSource } from '../../../shared/ai/types'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTableColumns, faPenToSquare, faPaperPlane, faStop, faChevronDown, faChevronRight } from '@fortawesome/free-solid-svg-icons'
import IconButton from '../common/iconButton'
import CollapsibleSection from '../common/collapsibleSection'
import './aiChat.css'

function MessageSources({ sources }: { sources: DocSource[] }): React.JSX.Element {
    const [open, setOpen] = useState(false)
    return (
        <div className="ai-chat-sources">
            <button type="button" data-testid="ai-chat-sources-toggle" className="ai-chat-sources-toggle" onClick={() => setOpen(prev => !prev)}>
                <FontAwesomeIcon icon={open ? faChevronDown : faChevronRight} /> Used docs ({sources.length})
            </button>
            {open && (
                <ul className="ai-chat-sources-list">
                    {sources.map(source => (
                        <li key={source.path}>
                            <button type="button" className="ai-chat-source-link" onClick={() => { void window.rokdock.docs.lookUp(source.title) }}>{source.title}</button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

export default function AiChatPanel({ flow = false }: { flow?: boolean } = {}): React.JSX.Element {
    const messages = useAppStore(state => state.aiChatMessages)
    const streaming = useAppStore(state => state.aiChatStreaming)
    const error = useAppStore(state => state.aiChatError)
    const symbols = useAppStore(state => state.aiDocSymbols)
    const sendChatMessage = useAppStore(state => state.sendChatMessage)
    const cancelChat = useAppStore(state => state.cancelChat)
    const newChat = useAppStore(state => state.newChat)
    const aiChatOpen = useAppStore(state => state.aiChatOpen)
    const toggleAiChat = useAppStore(state => state.toggleAiChat)
    const aiChatDock = useAppStore(state => state.aiChatDock)
    const cycleAiChatDock = useAppStore(state => state.cycleAiChatDock)
    const [draft, setDraft] = useState('')
    const listRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const el = listRef.current
        if (el?.scrollTo) el.scrollTo({ top: el.scrollHeight })
    }, [messages, streaming])

    const submit = (): void => {
        const text = draft
        if (!text.trim() || streaming) return
        setDraft('')
        void sendChatMessage(text)
    }

    const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
        }
    }

    const ACTIONS = (
        <>
            <IconButton size="sm" data-testid="ai-chat-dock" title={`Move AI Chat (currently ${aiChatDock})`} onClick={cycleAiChatDock}>
                <FontAwesomeIcon icon={faTableColumns} />
            </IconButton>
            <IconButton size="sm" data-testid="ai-chat-new" title="New chat" onClick={newChat}>
                <FontAwesomeIcon icon={faPenToSquare} />
            </IconButton>
        </>
    )

    const rootStyle = flow ? ROOT_STYLE_FLOW : ROOT_STYLE_DOCK
    const sectionStyle = flow ? undefined : SECTION_STYLE_DOCK
    const sectionBodyStyle = flow ? SECTION_BODY_BASE : SECTION_BODY_STYLE_DOCK
    const listStyle = flow ? LIST_STYLE_FLOW : LIST_STYLE

    return (
        <div
            data-testid="ai-chat-panel"
            style={rootStyle}
        >
            <CollapsibleSection
                collapsible
                open={aiChatOpen}
                onToggle={toggleAiChat}
                headerTestId="ai-chat-toggle"
                title={withBeta(AI_CHAT_TITLE)}
                style={sectionStyle}
                bodyStyle={sectionBodyStyle}
                actions={ACTIONS}
            >
                <div ref={listRef} style={listStyle}>
                    {messages.length === 0 && !streaming && (
                        <div style={EMPTY_STYLE}>Ask about Roku, BrightScript, or SceneGraph, or paste output to explain.</div>
                    )}
                    {messages.map((message, i) => (
                        <div
                            key={i}
                            data-testid="ai-chat-message"
                            style={message.role === 'user' ? USER_MSG_STYLE : AI_MSG_STYLE}
                        >
                            {message.role === 'assistant' ? <ChatMarkdown text={message.content} symbols={symbols} /> : message.content}
                            {message.role === 'assistant' && message.sources && message.sources.length > 0 && <MessageSources sources={message.sources} />}
                        </div>
                    ))}
                    {streaming && (
                        <div style={AI_MSG_STYLE} data-testid="ai-chat-streaming">
                            {streaming.text
                                ? <ChatMarkdown text={streaming.text} symbols={symbols} />
                                : streaming.activity
                                    ? <div className="ai-chat-activity" data-testid="ai-chat-activity">{streaming.activity}</div>
                                    : <span className="ai-chat-typing" role="status" aria-label="Assistant is thinking"><span /><span /><span /></span>}
                        </div>
                    )}
                </div>
                {error && <div data-testid="ai-chat-error" style={ERROR_STYLE}>{error}</div>}
                <div style={INPUT_ROW_STYLE}>
                    <textarea
                        data-testid="ai-chat-input"
                        className="rokdock-input"
                        style={INPUT_STYLE}
                        value={draft}
                        placeholder="Ask anything..."
                        rows={2}
                        onChange={e => setDraft(e.target.value)}
                        onKeyDown={onKeyDown}
                    />
                    {streaming
                        ? <IconButton size="md" data-testid="ai-chat-cancel" title="Stop" onClick={cancelChat}><FontAwesomeIcon icon={faStop} /></IconButton>
                        : <IconButton size="md" data-testid="ai-chat-send" title="Send" onClick={submit} disabled={!draft.trim()}><FontAwesomeIcon icon={faPaperPlane} /></IconButton>
                    }
                </div>
            </CollapsibleSection>
        </div>
    )
}

// root
const ROOT_STYLE_FLOW: React.CSSProperties = { height: 'auto' }
const ROOT_STYLE_DOCK: React.CSSProperties = { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }

// section wrapper
const SECTION_STYLE_DOCK: React.CSSProperties = { flex: 1, minHeight: 0 }

// section body - shared base fields
const SECTION_BODY_BASE: React.CSSProperties = { display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--rokdock-bg-panel)' }
const SECTION_BODY_STYLE_DOCK: React.CSSProperties = { flex: 1, minHeight: 0, ...SECTION_BODY_BASE }

const LIST_STYLE_BASE: React.CSSProperties = { overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }
const LIST_STYLE: React.CSSProperties = { ...LIST_STYLE_BASE, flex: 1, minHeight: 0 }
const LIST_STYLE_FLOW: React.CSSProperties = { ...LIST_STYLE_BASE, maxHeight: 320 }

const EMPTY_STYLE: React.CSSProperties = {
    color: 'var(--rokdock-text-dim)',
    fontSize: 'var(--rokdock-font-sm)',
    padding: 8,
}

const USER_MSG_STYLE: React.CSSProperties = {
    alignSelf: 'flex-end',
    background: 'var(--rokdock-brand-primary)',
    color: 'var(--rokdock-btn-text)',
    borderRadius: 8,
    padding: '6px 10px',
    maxWidth: '90%',
    whiteSpace: 'pre-wrap',
    fontSize: 'var(--rokdock-font-sm)',
}

const AI_MSG_STYLE: React.CSSProperties = {
    alignSelf: 'flex-start',
    background: 'var(--rokdock-bg-surface)',
    borderRadius: 8,
    padding: '6px 10px',
    maxWidth: '95%',
    fontSize: 'var(--rokdock-font-sm)',
}

const ERROR_STYLE: React.CSSProperties = {
    color: 'var(--rokdock-state-error)',
    fontSize: 'var(--rokdock-font-sm)',
    padding: '4px 8px',
    flexShrink: 0,
}

const INPUT_ROW_STYLE: React.CSSProperties = {
    display: 'flex',
    gap: 6,
    padding: 8,
    borderTop: '1px solid var(--rokdock-border)',
    alignItems: 'flex-end',
    flexShrink: 0,
}

const INPUT_STYLE: React.CSSProperties = {
    flex: 1,
    resize: 'none',
}
