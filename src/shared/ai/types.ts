/**
 * The IPC/UI contract for AI features. AiProfile is renderer-safe (carries hasKey,
 * never the key). The request/chunk shapes are re-exported from the portable core
 * so there is one request shape across the app, not two.
 */
import type { AiAdapterType, AiRequest, AiStreamChunk, ChatMessage as CoreChatMessage, CliKind } from '../../ai-core/types'

export type { AiAdapterType, AiRequest, AiStreamChunk, CliKind }

/** A resolved docs page that was fetched as context during a stream. RokDock docs-subsystem concept. */
export interface DocSource {
    path: string
    title: string
}

/**
 * One turn in a conversation, with optional source attribution for the UI layer.
 * Extends the portable core turn shape (role + content) with RokDock-specific metadata.
 * `image` is display-only, a captured screenshot shown inline. It is never sent to the model.
 */
export interface ChatMessage extends CoreChatMessage {
    sources?: DocSource[]
    image?: { thumbnailDataUrl: string; deviceIp: string; path: string }
}

/** A screenshot roBot captured, pushed to the chat for inline display (never sent to the model). */
export interface AiChatImage {
    thumbnailDataUrl: string
    /** Saved file path, so a click can open this exact shot in the viewer. */
    path: string
    deviceIp: string
    deviceName: string
}

/** Renderer-safe profile. The key itself is never included. hasKey reports its presence. */
export interface AiProfile {
    id: string
    name: string
    adapter: AiAdapterType
    model: string
    baseUrl?: string
    /** Set on CLI providers (adapter 'cli'); identifies which recognized CLI this is. */
    cliKind?: CliKind
    isLocal: boolean
    redactionEnabled: boolean
    hasKey: boolean
}

/** Persisted shape of an AI profile. hasKey is always recomputed from the secrets file and is not stored. */
export type StoredAiProfile = Omit<AiProfile, 'hasKey' | 'cliKind'>

/** Optional per-CLI customization of an auto-detected provider. */
export interface CliOverride { model?: string; redactionEnabled?: boolean; hidden?: boolean }
export type AiCliOverrides = Partial<Record<CliKind, CliOverride>>

/** What the renderer sends to create or update a profile. An undefined key leaves the stored key unchanged. An empty string clears it. */
export interface AiProfileInput {
    id?: string
    name: string
    adapter: AiAdapterType
    /** Set when adapter is 'cli': which recognized CLI this input configures. */
    cliKind?: CliKind
    model: string
    baseUrl?: string
    isLocal: boolean
    redactionEnabled: boolean
    key?: string
}

export interface AiTestResult {
    ok: boolean
    text?: string
    error?: string
}

export interface RedactionPreview {
    text: string
    replacements: Array<{ label: string; count: number }>
}

/**
 * A prompt the AI stream (main) asks the renderer to present to the user, awaiting a reply.
 * `confirm` gates a state-changing tool action; `choice` lets the assistant offer clickable
 * options instead of the user typing an answer. Keyed by requestId for the response.
 */
export type AiUiRequest =
    | { requestId: string; kind: 'confirm'; summary: string }
    | { requestId: string; kind: 'choice'; question: string; options: string[] }

/** The user's reply to an AiUiRequest, sent back to main by requestId. */
export type AiUiResponse =
    | { requestId: string; kind: 'confirm'; choice: 'deny' | 'once' | 'chat' }
    | { requestId: string; kind: 'choice'; value: string | null }
