/**
 * The single subscriber to roBot's UI prompts. A confirm prompt (approve a state-changing
 * device action) shows here as the app's own dialog (not a native OS box). A choice prompt
 * (pick from options) is routed into the store so the chat panel can render it inline and it
 * survives a panel remount. Mounted once at the app root. When the turn ends (done or Stop),
 * any still-open prompt is dismissed since main has already settled the awaited reply.
 */
import React, { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { AiUiRequest } from '../../../shared/ai/types'
import { useAppStore } from '../../store/appStore'
import ConfirmDialog from '../common/confirmDialog'

const GRANT_LABEL: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--rokdock-font-sm)',
    color: 'var(--rokdock-text-dim)', cursor: 'pointer',
}

export default function AiUiPrompt(): React.JSX.Element | null {
    const streaming = useAppStore(state => state.aiChatStreaming)
    const setChoice = useAppStore(state => state.setAiChatChoice)
    const [request, setRequest] = useState<{ requestId: string; summary: string } | null>(null)
    const [grantChat, setGrantChat] = useState(false)

    useEffect(() => window.rokdock.ai.onUiRequest((next: AiUiRequest) => {
        if (next.kind === 'confirm') {
            setGrantChat(false)
            setRequest({ requestId: next.requestId, summary: next.summary })
        } else if (next.kind === 'choice') {
            setChoice(next)
        }
    }), [setChoice])

    // The turn ended (finished or the user pressed Stop): drop any open prompt. Main has already
    // resolved the awaited reply (to a decline on abort), so leaving one up would be stale.
    useEffect(() => {
        if (!streaming) {
            setRequest(null)
            setChoice(null)
        }
    }, [streaming, setChoice])

    if (!request) return null

    const respond = (choice: 'deny' | 'once' | 'chat'): void => {
        window.rokdock.ai.respondUi({ requestId: request.requestId, kind: 'confirm', choice })
        setRequest(null)
    }

    return (
        <ConfirmDialog
            open
            title="roBot wants to control your Roku"
            message={request.summary}
            confirmLabel="Allow"
            cancelLabel="Deny"
            onConfirm={() => respond(grantChat ? 'chat' : 'once')}
            onCancel={() => respond('deny')}
        >
            <label style={GRANT_LABEL}>
                <input type="checkbox" checked={grantChat} onChange={event => setGrantChat(event.target.checked)} />
                Allow for the rest of this chat
            </label>
        </ConfirmDialog>
    )
}
