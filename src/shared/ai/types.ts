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
 */
export interface ChatMessage extends CoreChatMessage {
    sources?: DocSource[]
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
