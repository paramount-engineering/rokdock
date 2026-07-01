/**
 * Internal script data model for the RokDock script recorder, editor, and playback engine.
 *
 * Scripts are stored as JSON (ScriptFile) and can be imported from / exported to
 * RASP YAML format for interoperability with Roku's official Remote Automation Script Player.
 * The Step union covers all supported action types; RASP-incompatible types (block, assertQuery,
 * etc.) are RokDock-only extensions that cannot round-trip through RASP.
 *
 * Utility functions at the bottom (validateScript, extractTokens, substituteTokens) are used
 * by both the main process (script engine) and the renderer (editor UI).
 */

// Internal script format for RokDock script recorder/editor/engine.
// JSON is the canonical storage format. RASP YAML is an interop boundary only.

export interface ScriptFile {
    version: 1
    name: string
    raspMode: boolean
    metadata?: RaspMetadata
    steps: Step[]
}

// Metadata preserved from RASP import (requirements block, params)
export interface RaspMetadata {
    raspVersion?: number
    defaultKeypressWait?: number
    channelName?: string
    channelId?: string | number
    channels?: Record<string, number> | string[]
    requirements?: Record<string, unknown>
    variables?: Record<string, string>
}

// Annotation attached to a step - used for import warnings and RASP compatibility flags
export interface StepAnnotation {
    level: 'warning' | 'error'
    message: string
}

// Step union

export type Step =
    | PressStep
    | KeyDownStep
    | KeyUpStep
    | TextStep
    | DelayStep
    | ScreenshotStep
    | LaunchStep
    | LoopStep
    | WaitPlayerStateStep
    | ValidateStreamingStep
    | ChannelTileOrderStep
    | WaitActiveAppStep
    | AssertQueryStep
    | CommentStep
    | BlockDefinitionStep
    | BlockReferenceStep
    | UnknownStep

// Step variants

export interface PressStep {
    type: 'press'
    key: string
    disabled?: boolean
    annotations?: StepAnnotation[]
    onError?: Step[]
}

export interface KeyDownStep {
    type: 'key_down'
    key: string
    disabled?: boolean
    annotations?: StepAnnotation[]
    onError?: Step[]
}

export interface KeyUpStep {
    type: 'key_up'
    key: string
    disabled?: boolean
    annotations?: StepAnnotation[]
    onError?: Step[]
}

export interface TextStep {
    type: 'text'
    value: string
    disabled?: boolean
    annotations?: StepAnnotation[]
    onError?: Step[]
}

export interface DelayStep {
    type: 'delay'
    // Duration in milliseconds
    durationMs: number
    disabled?: boolean
    annotations?: StepAnnotation[]
    onError?: Step[]
}

export interface ScreenshotStep {
    type: 'screenshot'
    marker: string
    disabled?: boolean
    annotations?: StepAnnotation[]
    onError?: Step[]
}

export interface LaunchStep {
    type: 'launch'
    channelName?: string
    channelId?: string | number
    disabled?: boolean
    annotations?: StepAnnotation[]
    onError?: Step[]
}

export type PlayerState = 'play' | 'pause' | 'stop' | 'buffering' | 'finished'

export interface WaitPlayerStateStep {
    type: 'waitPlayerState'
    state: PlayerState
    // Poll interval in ms (default 10000)
    intervalMs?: number
    // Timeout in ms (default 120000)
    timeoutMs?: number
    disabled?: boolean
    annotations?: StepAnnotation[]
    onError?: Step[]
}

export type OnNotPlaying = 'fail' | 'skip' | 'wait'

export interface ValidateStreamingStep {
    type: 'validateStreaming'
    // Codec assertions - each is optional; only specified fields are checked
    audioCodec?: string
    videoCodec?: string
    // What to do if the player is not in a playing state when this step runs
    onNotPlaying?: OnNotPlaying
    // Raw audio_only field from RASP import - non-functional but preserved
    audioOnly?: boolean
    drm?: string
    skipVideoValidation?: boolean
    skipBitrateValidation?: boolean
    disabled?: boolean
    annotations?: StepAnnotation[]
    onError?: Step[]
}

export interface ChannelTileOrderStep {
    type: 'channelTileOrder'
    channels: string[]
    disabled?: boolean
    annotations?: StepAnnotation[]
    onError?: Step[]
}

export interface LoopStep {
    type: 'loop'
    iterations: number
    steps: Step[]
    disabled?: boolean
    annotations?: StepAnnotation[]
    onError?: Step[]
}

// Extended step types (no RASP equivalent)

export interface WaitActiveAppStep {
    type: 'waitActiveApp'
    appId: string
    // Poll interval in ms (default 2000)
    intervalMs?: number
    // Timeout in ms (default 30000)
    timeoutMs?: number
    disabled?: boolean
    annotations?: StepAnnotation[]
    onError?: Step[]
}

export interface AssertQueryStep {
    type: 'assertQuery'
    // ECP endpoint path, e.g. '/query/media-player'
    endpoint: string
    // Dot-separated path into parsed XML response, e.g. 'root.Player.Plugin.id'
    field: string
    expected: string
    disabled?: boolean
    annotations?: StepAnnotation[]
    onError?: Step[]
}

export interface UnknownStep {
    type: 'unknown'
    // The original raw RASP step content as a string, for display purposes
    raw: string
    disabled?: boolean
    annotations?: StepAnnotation[]
    onError?: Step[]
}

export interface CommentStep {
    type: 'comment'
    text: string
    disabled?: boolean
    annotations?: StepAnnotation[]
    onError?: Step[]
}

export interface BlockDefinitionStep {
    type: 'block'
    name: string
    steps: Step[]
    disabled?: boolean
    annotations?: StepAnnotation[]
    onError?: Step[]
}

export interface BlockReferenceStep {
    type: 'block-ref'
    name: string
    disabled?: boolean
    annotations?: StepAnnotation[]
    onError?: Step[]
}

/**
 * Validates the top-level shape of a parsed ScriptFile object.
 * Does not validate individual steps - use this as a quick sanity check
 * after JSON.parse before handing the object to the rest of the engine.
 *
 * @param obj - Any value, typically the result of JSON.parse.
 * @returns An error message string if validation fails, or `null` if the structure is valid.
 */
export function validateScript(obj: unknown): string | null {
    if (!obj || typeof obj !== 'object') return 'Script must be an object'
    const scriptObj = obj as Record<string, unknown>
    if (scriptObj.version !== 1) return 'Script version must be 1'
    if (typeof scriptObj.name !== 'string') return 'Script name must be a string'
    if (!Array.isArray(scriptObj.steps)) return 'Script steps must be an array'
    return null
}

/** Extract all ${...} token names from a script's text steps. */
export function extractTokens(steps: Step[]): string[] {
    const tokens = new Set<string>()
    const regex = /\$\{([^}]+)\}/g
    for (const step of steps) {
        if (step.type === 'text') {
            let match
            while ((match = regex.exec(step.value)) !== null) tokens.add(match[1])
            regex.lastIndex = 0
        }
        if (step.type === 'loop') {
            for (const name of extractTokens(step.steps)) tokens.add(name)
        }
    }
    return [...tokens]
}

/** Replace ${...} tokens in a string using a variables map. */
export function substituteTokens(text: string, variables: Record<string, string>): string {
    return text.replace(/\$\{([^}]+)\}/g, (match, name) => {
        return name in variables ? variables[name] : match
    })
}

// Engine events (sent from main process to renderer via IPC)

/**
 * Discriminated union of all events emitted by ScriptEngine during playback.
 * Defined in shared so the renderer can import the canonical type without
 * crossing the Electron main/renderer boundary.
 */
export type EngineEvent =
    | { type: 'step-start';     label: string; index: number }
    | { type: 'step-complete';  label: string; index: number }
    | { type: 'step-failed';    label: string; index: number; error: string }
    | { type: 'step-skipped';   label: string; index: number }
    | { type: 'engine-complete' }
    | { type: 'engine-failed';  error: string }
    | { type: 'engine-stopped' }
