/**
 * The AI Chat (Beta) panel: a general-purpose, multi-turn assistant docked in the
 * left column. Drives the store's chat slice. Streams replies into a live bubble.
 */
import React, { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../store/appStore'
import ChatMarkdown from './chatMarkdown'
import { roBot } from './roBotMark'
import { AI_CHAT_TITLE, AI_BETA_SUFFIX } from '../../../shared/ai/labels'
import type { DocSource } from '../../../shared/ai/types'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowRightArrowLeft, faPenToSquare, faPaperPlane, faStop, faChevronDown, faChevronRight, faGear } from '@fortawesome/free-solid-svg-icons'
import IconButton from '../common/iconButton'
import CollapsibleSection from '../common/collapsibleSection'
import './aiChat.css'

/**
 * An inline screenshot roBot captured. Renders a clickable thumbnail that opens the exact shot
 * in the full viewer; if the thumbnail fails to load, it degrades to a clickable text fallback.
 */
function ChatScreenshot({ image }: { image: { thumbnailDataUrl: string; deviceIp: string; path: string } }): React.JSX.Element {
    const [failed, setFailed] = useState(false)
    const open = (): void => { void window.rokdock.device.openScreenshotWindow(image.deviceIp, undefined, image.path) }
    if (failed) {
        return (
            <button type="button" className="rokdock-btn rokdock-btn-ghost" data-testid="ai-chat-screenshot-fallback" style={SCREENSHOT_FALLBACK_STYLE} onClick={open}>
                Screenshot preview unavailable. Open in the viewer.
            </button>
        )
    }
    return (
        <img
            src={image.thumbnailDataUrl}
            alt="Device screenshot"
            title="Open in the Screenshot viewer"
            data-testid="ai-chat-screenshot"
            style={SCREENSHOT_THUMB_STYLE}
            onClick={open}
            onError={() => setFailed(true)}
        />
    )
}

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
    const setSettingsDialogOpen = useAppStore(state => state.setSettingsDialogOpen)
    const [draft, setDraft] = useState('')
    // roBot's inline "pick one" question. Held in the store (set by the global prompt subscriber)
    // so it survives a dock switch that remounts this panel, and cleared when the turn ends.
    const choice = useAppStore(state => state.aiChatChoice)
    const setAiChatChoice = useAppStore(state => state.setAiChatChoice)
    const appendChoiceExchange = useAppStore(state => state.appendChoiceExchange)
    const listRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const element = listRef.current
        if (element?.scrollTo) element.scrollTo({ top: element.scrollHeight })
    }, [messages, streaming, choice])

    const answerChoice = (value: string): void => {
        if (!choice) return
        // Keep the exchange in the transcript, then reply and clear the inline prompt.
        appendChoiceExchange(choice.question, value)
        window.rokdock.ai.respondUi({ requestId: choice.requestId, kind: 'choice', value })
        setAiChatChoice(null)
    }

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
            <IconButton size="sm" data-testid="ai-chat-dock" title={`Move ${AI_CHAT_TITLE} (currently ${aiChatDock})`} onClick={cycleAiChatDock}>
                <FontAwesomeIcon icon={faArrowRightArrowLeft} />
            </IconButton>
            <IconButton size="sm" data-testid="ai-chat-new" title="New chat" onClick={newChat}>
                <FontAwesomeIcon icon={faPenToSquare} />
            </IconButton>
            <IconButton size="sm" data-testid="ai-chat-settings" title={`${AI_CHAT_TITLE} settings`} onClick={() => setSettingsDialogOpen('ai')}>
                <FontAwesomeIcon icon={faGear} />
            </IconButton>
        </>
    )

    // flow mode fills its flex parent (the right panel below the other sections); dock mode
    // fills its own container (the middle drawer / left panel). Everything else (section, body,
    // and growing list) is identical, so only the root differs.
    const rootStyle = flow ? ROOT_STYLE_FLOW : ROOT_STYLE_DOCK

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
                title={
                    <span style={TITLE_ROW_STYLE}>
                        {/* 1px optical nudge up: the icon is bottom-heavy, so geometric center reads low. */}
                        <roBot.Wordmark height={22} style={WORDMARK_NUDGE_STYLE} />
                        <span style={VISUALLY_HIDDEN}>{`${AI_CHAT_TITLE} `}</span>
                        <span style={BETA_SUFFIX_STYLE}>{AI_BETA_SUFFIX}</span>
                    </span>
                }
                style={SECTION_STYLE}
                bodyStyle={SECTION_BODY_STYLE}
                actions={ACTIONS}
            >
                <div ref={listRef} style={LIST_STYLE}>
                    {messages.length === 0 && !streaming && (
                        <div style={EMPTY_STYLE}>Ask roBot about Roku, BrightScript, or SceneGraph, or paste output to explain.</div>
                    )}
                    {messages.map((message, i) => (
                        <div
                            key={i}
                            data-testid="ai-chat-message"
                            style={message.role === 'user' ? USER_MSG_STYLE : AI_MSG_STYLE}
                        >
                            {/* Assistant replies are markdown. User messages are shown verbatim,
                                except when they carry a fenced code block (e.g. an "Ask roBot"
                                terminal selection), which we render as markdown so the fence
                                becomes a real code block instead of literal backticks. */}
                            {message.role === 'assistant' || message.content.includes('```')
                                ? <ChatMarkdown text={message.content} symbols={symbols} />
                                : message.content}
                            {message.image && <ChatScreenshot image={message.image} />}
                            {message.role === 'assistant' && message.sources && message.sources.length > 0 && <MessageSources sources={message.sources} />}
                        </div>
                    ))}
                    {streaming && (
                        <div style={AI_MSG_STYLE} data-testid="ai-chat-streaming">
                            {streaming.text
                                ? <ChatMarkdown text={streaming.text} symbols={symbols} />
                                : streaming.activity
                                    ? <div className="ai-chat-activity" data-testid="ai-chat-activity">{streaming.activity}</div>
                                    : <span style={THINKING_ROW_STYLE}><roBot.Glyph size={20} /><span className="ai-chat-typing" role="status" aria-label="roBot is thinking"><span /><span /><span /></span></span>}
                        </div>
                    )}
                    {choice && (
                        <div style={AI_MSG_STYLE} data-testid="ai-chat-choice">
                            <div style={CHOICE_QUESTION_STYLE}>{choice.question}</div>
                            <div style={CHOICE_OPTIONS_STYLE}>
                                {choice.options.map((option, index) => (
                                    <button
                                        key={`${index}-${option}`}
                                        type="button"
                                        data-testid="ai-chat-choice-option"
                                        className="rokdock-btn rokdock-btn-ghost"
                                        style={CHOICE_OPTION_STYLE}
                                        onClick={() => answerChoice(option)}
                                    >
                                        {option}
                                    </button>
                                ))}
                            </div>
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
                        placeholder="Ask roBot anything..."
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

// root: flow grows to fill the right panel's remaining space (a flex child, with a floor so
// it never collapses when the sections above are tall); dock fills its own container.
const ROOT_STYLE_FLOW: React.CSSProperties = { flex: 1, minHeight: 180, display: 'flex', flexDirection: 'column', overflow: 'hidden' }
const ROOT_STYLE_DOCK: React.CSSProperties = { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }

// The section, its body, and the message list are the same in both modes (only the
// root differs); the list grows to fill and scrolls internally.
const SECTION_STYLE: React.CSSProperties = { flex: 1, minHeight: 0 }
const SECTION_BODY_STYLE: React.CSSProperties = { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--rokdock-bg-panel)' }
const LIST_STYLE: React.CSSProperties = { flex: 1, minHeight: 0, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }
// Header title: the wordmark logo, an off-screen "roBot" name, and the visible "(Beta)".
const TITLE_ROW_STYLE: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 3, verticalAlign: 'middle', lineHeight: 0 }
const WORDMARK_NUDGE_STYLE: React.CSSProperties = { transform: 'translateY(-1px)' }
const BETA_SUFFIX_STYLE: React.CSSProperties = { fontSize: 'var(--rokdock-font-xxs)', color: 'var(--rokdock-text-muted)', fontWeight: 400 }
// Off-screen text equivalent: the wordmark SVG has no text nodes, so the header carries
// the "roBot" name here for screen readers and tests while staying visually the logo.
const VISUALLY_HIDDEN: React.CSSProperties = { position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }
// The streaming "thinking" row: the glyph beside the animated typing dots. Block flex (not
// inline-flex) so it centers vertically in the bubble instead of baseline-aligning high.
const THINKING_ROW_STYLE: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 }

// Inline screenshot thumbnail roBot captured. A click opens the full Screenshot viewer.
const SCREENSHOT_THUMB_STYLE: React.CSSProperties = { display: 'block', marginTop: 6, maxWidth: '100%', borderRadius: 6, cursor: 'pointer', border: '1px solid var(--rokdock-border)' }
// Shown in place of the thumbnail when the inline preview cannot be rendered.
const SCREENSHOT_FALLBACK_STYLE: React.CSSProperties = { marginTop: 6, justifyContent: 'flex-start', textAlign: 'left', fontSize: 'var(--rokdock-font-sm)' }

// roBot's inline "pick one" question: the prompt text above a column of clickable options.
const CHOICE_QUESTION_STYLE: React.CSSProperties = { fontSize: 'var(--rokdock-font-sm)', marginBottom: 8 }
const CHOICE_OPTIONS_STYLE: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 }
const CHOICE_OPTION_STYLE: React.CSSProperties = { justifyContent: 'flex-start', textAlign: 'left' }

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
