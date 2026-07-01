/**
 * Script playback engine for RokDock automation scripts.
 *
 * Executes a ScriptFile step-by-step against a target Roku device over ECP.
 * Each step is dispatched via the EcpService (keypress, text, launch, etc.)
 * or resolved locally (delay, comment). More complex steps like waitPlayerState
 * and validateStreaming poll ECP endpoints until a condition is met or a timeout fires.
 *
 * Execution model:
 *  - play() is non-blocking; it runs async and emits EngineEvent callbacks for each
 *    step lifecycle (step-start, step-complete, step-failed, engine-complete, etc.).
 *  - stop() sets a flag that is checked between steps to allow graceful cancellation.
 *  - Blocks (BlockDefinitionStep) are pre-indexed at startup and called by name via
 *    BlockReferenceStep. Recursive/nested block calls are supported.
 *  - Loop steps execute their nested step list N times.
 *  - Variable substitution (${name} tokens) is applied to text steps at runtime
 *    using values from the script's variables map.
 *
 * EngineEvent is the data type pushed to the renderer during playback so the script
 * editor UI can update its live execution display.
 */

import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import { ecpRequest, type EcpService } from './ecp'
import type {
    ScriptFile, Step,
    PressStep, KeyDownStep, KeyUpStep, TextStep, DelayStep, LaunchStep, LoopStep,
    WaitPlayerStateStep, ValidateStreamingStep, ChannelTileOrderStep,
    WaitActiveAppStep, AssertQueryStep, UnknownStep,
    BlockDefinitionStep, BlockReferenceStep,
    EngineEvent
} from '../../shared/script'
import { substituteTokens } from '../../shared/script'
export type { EngineEvent } from '../../shared/script'
import { xmlParser } from '../utils/xml'

// -- Execution log -------------------------------------------------------------

export type StepStatus = 'pending' | 'running' | 'complete' | 'failed' | 'skipped'

export interface StepLogEntry {
    // Flat index in the execution sequence (counting nested steps)
    index: number
    // Human-readable step path, e.g. "3" or "5.2" for nested
    label: string
    type: string
    status: StepStatus
    startedAt?: number
    completedAt?: number
    error?: string
}

export interface ExecutionLog {
    scriptName: string
    startedAt: number
    completedAt?: number
    outcome: 'complete' | 'failed' | 'stopped'
    entries: StepLogEntry[]
}

// -- Script engine -------------------------------------------------------------

const DEFAULT_POLL_INTERVAL_MS = 2000
const DEFAULT_TIMEOUT_MS = 30000
const WAIT_PLAYER_STATE_TIMEOUT_MS = 120_000
const WAIT_PLAYER_STATE_POLL_MS = 10_000
const SKIP_PING_STEP_TYPES = new Set(['delay', 'screenshot', 'comment', 'block', 'block-ref'])

/**
 * Executes a `ScriptFile` step-by-step against a target Roku device.
 *
 * One instance should be created per playback session. It is not reusable across
 * concurrent scripts - create a new instance for each parallel execution.
 */
export class ScriptEngine {
    private stopRequested = false
    private logEntries: StepLogEntry[] = []
    private flatIndex = 0
    private keypressWaitMs = 0
    private variables: Record<string, string> = {}
    private blockDefs: Map<string, BlockDefinitionStep> = new Map()

    /**
     * @param ecp - ECP service used to send commands to the device.
     * @param onEvent - Callback invoked for each engine lifecycle event so the renderer
     *   can update the live execution display.
     */
    constructor(
        private readonly ecp: EcpService,
        private readonly onEvent: (event: EngineEvent) => void
    ) {}

    // -- Public API ------------------------------------------------------------

    /**
     * Starts script execution against the given device IP address.
     *
     * Resets all per-run state, pre-indexes block definitions, then walks through
     * the step list. On completion (success, failure, or stop), the log is written
     * to the userData `scripts/logs/` directory and the appropriate engine event is emitted.
     *
     * @param script - The script to execute.
     * @param deviceIp - IPv4 address of the target Roku device.
     * @returns A resolved `ExecutionLog` once the run ends (regardless of outcome).
     */
    async play(script: ScriptFile, deviceIp: string): Promise<ExecutionLog> {
        this.stopRequested = false
        this.logEntries = []
        this.flatIndex = 0
        this.keypressWaitMs = script.metadata?.defaultKeypressWait
            ? Math.round(script.metadata.defaultKeypressWait * 1000)
            : 0
        this.variables = script.metadata?.variables ?? {}
        this.blockDefs = this.collectBlockDefs(script.steps)

        const log: ExecutionLog = {
            scriptName: script.name,
            startedAt: Date.now(),
            outcome: 'complete',
            entries: this.logEntries
        }

        try {
            await this.executeSteps(script.steps, deviceIp, '')
        } catch (err) {
            if (err instanceof StopSignal) {
                log.outcome = 'stopped'
                this.onEvent({ type: 'engine-stopped' })
            } else {
                log.outcome = 'failed'
                const message = err instanceof Error ? err.message : String(err)
                this.onEvent({ type: 'engine-failed', error: message })
            }
        } finally {
            log.completedAt = Date.now()
            if (log.outcome === 'complete') {
                this.onEvent({ type: 'engine-complete' })
            }
            this.persistLog(log)
        }

        return log
    }

    /**
     * Requests a graceful stop after the current step finishes.
     * The engine will throw a `StopSignal` on the next step boundary.
     */
    stop(): void {
        this.stopRequested = true
    }

    // -- Step executor dispatch ------------------------------------------------

    /**
     * Iterates a step array, executing each enabled step in sequence.
     *
     * Handles the per-step lifecycle: ping check, dispatch, log entry, event emission,
     * and `onError` handler execution. Disabled steps are skipped silently.
     * Throws `StopSignal` when `stop()` has been requested.
     *
     * @param steps - Steps to execute.
     * @param ip - Target device IP.
     * @param prefix - Dot-notation label prefix for nested steps (e.g. `"3"`, `"5.2"`).
     */
    private async executeSteps(steps: Step[], ip: string, prefix: string): Promise<void> {
        for (let i = 0; i < steps.length; i++) {
            if (this.stopRequested) throw new StopSignal()

            const step = steps[i]
            if (step.disabled) continue

            const label = prefix ? `${prefix}.${i + 1}` : String(i + 1)
            const entryIndex = this.flatIndex++

            const entry: StepLogEntry = {
                index: entryIndex,
                label,
                type: step.type,
                status: 'running',
                startedAt: Date.now()
            }
            this.logEntries.push(entry)
            this.onEvent({ type: 'step-start', label, index: entryIndex })

            try {
                if (!SKIP_PING_STEP_TYPES.has(step.type)) {
                    await this.ecp.ping(ip)
                }
                await this.executeStep(step, ip, label)
                entry.status = 'complete'
                entry.completedAt = Date.now()
                this.onEvent({ type: 'step-complete', label, index: entryIndex })
            } catch (err) {
                if (err instanceof StopSignal) throw err
                if (err instanceof SkipSignal) {
                    entry.status = 'skipped'
                    entry.completedAt = Date.now()
                    this.onEvent({ type: 'step-skipped', label, index: entryIndex })
                    continue
                }
                const message = err instanceof Error ? err.message : String(err)
                entry.status = 'failed'
                entry.completedAt = Date.now()
                entry.error = message
                this.onEvent({ type: 'step-failed', label, index: entryIndex, error: message })

                if (step.onError !== undefined) {
                    if (step.onError.length > 0) {
                        try {
                            await this.executeSteps(step.onError, ip, `${label}.e`)
                        } catch (handlerErr) {
                            if (handlerErr instanceof StopSignal) throw handlerErr
                            // onError handler itself failed - propagate the original error
                            throw err
                        }
                    }
                    // onError defined (even empty) = error was handled, continue script
                    continue
                }

                throw err
            }
        }
    }

    /**
     * Dispatches a single step to its concrete handler based on `step.type`.
     * Throws for unknown step types.
     *
     * @param step - The step to execute.
     * @param ip - Target device IP.
     * @param label - Human-readable step label used for block/loop context.
     */
    private async executeStep(step: Step, ip: string, label: string): Promise<void> {
        switch (step.type) {
            case 'press':         return this.execPress(step, ip)
            case 'key_down':      return this.execKeyDown(step, ip)
            case 'key_up':        return this.execKeyUp(step, ip)
            case 'text':          return this.execText(step, ip)
            case 'delay':         return this.execDelay(step)
            case 'launch':        return this.execLaunch(step, ip)
            case 'loop':          return this.execLoop(step, ip, label)
            case 'block':         return this.execBlock(step as BlockDefinitionStep, ip, label)
            case 'block-ref':     return this.execBlockRef(step as BlockReferenceStep, ip, label)
            case 'waitPlayerState':    return this.execWaitPlayerState(step, ip)
            case 'validateStreaming':  return this.execValidateStreaming(step, ip)
            case 'channelTileOrder':   return this.execChannelTileOrder(step, ip)
            case 'waitActiveApp':      return this.execWaitActiveApp(step, ip)
            case 'assertQuery':        return this.execAssertQuery(step, ip)
            case 'screenshot':        return // No-op: cert marker only
            case 'comment':           return // No-op: display only
            case 'unknown':            throw new SkipSignal()
            default:                  return assertNever(step)
        }
    }

    // -- Step implementations --------------------------------------------------

    /**
     * Sends a key press and waits for `keypressWaitMs` if a default inter-key delay
     * is configured on the script.
     */
    private async execPress(step: PressStep, ip: string): Promise<void> {
        await this.ecp.keypress(ip, step.key)
        if (this.keypressWaitMs > 0) await sleep(this.keypressWaitMs)
    }

    /** Sends a key-down (hold) event without a post-delay. */
    private async execKeyDown(step: KeyDownStep, ip: string): Promise<void> {
        await this.ecp.keydown(ip, step.key)
    }

    /** Sends a key-up (release) event. */
    private async execKeyUp(step: KeyUpStep, ip: string): Promise<void> {
        await this.ecp.keyup(ip, step.key)
    }

    /**
     * Resolves `${variable}` tokens in the step value against the script's variable map,
     * then types the resulting string character by character.
     */
    private async execText(step: TextStep, ip: string): Promise<void> {
        const resolved = substituteTokens(step.value, this.variables)
        await this.ecp.sendText(ip, resolved)
    }

    /** Pauses execution for the duration specified in the step. */
    private async execDelay(step: DelayStep): Promise<void> {
        await sleep(step.durationMs)
    }

    /**
     * Launches a channel by its numeric ID. Throws if `channelId` is absent or the
     * step only provides a name (ECP requires an ID).
     */
    private async execLaunch(step: LaunchStep, ip: string): Promise<void> {
        if (step.channelId !== undefined) {
            await this.ecp.launchApp(ip, step.channelId)
        } else if (step.channelName) {
            // Launch by name - ECP requires an app ID; best effort using the name
            // The caller is expected to have resolved the ID before scripting, or
            // the RASP params block should carry the channel_id.
            throw new Error(`Launch by channel name requires a channel ID. Resolve "${step.channelName}" to an app ID first.`)
        } else {
            throw new Error('Launch step requires channelId or channelName')
        }
    }

    /**
     * Executes the nested step list `step.iterations` times.
     * Checks for stop requests between iterations.
     */
    private async execLoop(step: LoopStep, ip: string, label: string): Promise<void> {
        for (let i = 0; i < step.iterations; i++) {
            if (this.stopRequested) throw new StopSignal()
            await this.executeSteps(step.steps, ip, label)
        }
    }

    /** Executes the inline steps of a block definition in place. */
    private async execBlock(step: BlockDefinitionStep, ip: string, label: string): Promise<void> {
        await this.executeSteps(step.steps, ip, label)
    }

    /**
     * Looks up a named block definition collected at startup and executes its steps.
     * Throws if the block name is not found in the pre-indexed map.
     */
    private async execBlockRef(step: BlockReferenceStep, ip: string, label: string): Promise<void> {
        const def = this.blockDefs.get(step.name)
        if (!def) throw new Error(`Block definition not found: ${step.name}`)
        await this.executeSteps(def.steps, ip, label)
    }

    /**
     * Recursively scans a step array and indexes all `BlockDefinitionStep` entries by name.
     * Also descends into `LoopStep` children. Called once at the start of `play()`.
     *
     * @param steps - Top-level (or nested) step list to scan.
     * @returns A map from block name to its definition.
     */
    private collectBlockDefs(steps: Step[]): Map<string, BlockDefinitionStep> {
        const map = new Map<string, BlockDefinitionStep>()
        const scan = (arr: Step[]) => {
            for (const step of arr) {
                if (step.type === 'block') {
                    map.set(step.name, step)
                    scan(step.steps)
                } else if (step.type === 'loop') {
                    scan(step.steps)
                }
            }
        }
        scan(steps)
        return map
    }

    /**
     * Polls the media player state until it matches `step.state` or the timeout elapses.
     * Default timeout is 120 seconds; default poll interval is 10 seconds.
     *
     * @throws If the expected state is not reached within the configured timeout.
     */
    private async execWaitPlayerState(step: WaitPlayerStateStep, ip: string): Promise<void> {
        const intervalMs = step.intervalMs ?? WAIT_PLAYER_STATE_POLL_MS
        const timeoutMs = step.timeoutMs ?? WAIT_PLAYER_STATE_TIMEOUT_MS
        const deadline = Date.now() + timeoutMs

        while (Date.now() < deadline) {
            if (this.stopRequested) throw new StopSignal()
            const state = await this.ecp.queryMediaPlayer(ip)
            if (state.state === step.state) return
            await sleep(Math.min(intervalMs, deadline - Date.now()))
        }

        throw new Error(`waitPlayerState timeout: expected "${step.state}" within ${timeoutMs}ms`)
    }

    /**
     * Asserts that the device is playing and optionally validates codec and DRM fields.
     *
     * If the player is not in a playing/buffering state, behaviour is controlled by
     * `step.onNotPlaying`: `'fail'` (default) throws immediately, `'skip'` raises a
     * `SkipSignal`, and `'wait'` polls until playing or a 30-second timeout expires.
     */
    private async execValidateStreaming(step: ValidateStreamingStep, ip: string): Promise<void> {
        const state = await this.ecp.queryMediaPlayer(ip)

        if (state.state !== 'play' && state.state !== 'buffering') {
            switch (step.onNotPlaying ?? 'fail') {
                case 'skip':
                    throw new SkipSignal()
                case 'wait': {
                    // Poll until playing
                    const intervalMs = DEFAULT_POLL_INTERVAL_MS
                    const timeoutMs = DEFAULT_TIMEOUT_MS
                    const deadline = Date.now() + timeoutMs
                    while (Date.now() < deadline) {
                        if (this.stopRequested) throw new StopSignal()
                        const state = await this.ecp.queryMediaPlayer(ip)
                        if (state.state === 'play' || state.state === 'buffering') {
                            return this.assertStreamingFields(step, state.audioCodec, state.videoCodec, state.drmType)
                        }
                        await sleep(Math.min(intervalMs, deadline - Date.now()))
                    }
                    throw new Error(`validateStreaming wait timeout: player did not enter play state within ${timeoutMs}ms`)
                }
                default:
                    throw new Error(`validateStreaming failed: player state is "${state.state}", expected playing`)
            }
        }

        this.assertStreamingFields(step, state.audioCodec, state.videoCodec, state.drmType)
    }

    /**
     * Compares the actual codec and DRM values from the media player against the
     * expectations declared in a `validateStreaming` step.
     *
     * @param step - The validation step containing expected codec/DRM values.
     * @param audioCodec - Actual audio codec reported by ECP.
     * @param videoCodec - Actual video codec reported by ECP.
     * @param drmType - Actual DRM type reported by ECP.
     * @throws If any expected field does not match the actual value.
     */
    private assertStreamingFields(
        step: ValidateStreamingStep,
        audioCodec?: string,
        videoCodec?: string,
        drmType?: string
    ): void {
        if (step.audioCodec !== undefined && step.audioCodec !== audioCodec) {
            throw new Error(`validateStreaming: audioCodec expected "${step.audioCodec}", got "${audioCodec ?? 'none'}"`)
        }
        if (!step.skipVideoValidation && step.videoCodec !== undefined && step.videoCodec !== videoCodec) {
            throw new Error(`validateStreaming: videoCodec expected "${step.videoCodec}", got "${videoCodec ?? 'none'}"`)
        }
        if (step.drm !== undefined && step.drm !== drmType) {
            throw new Error(`validateStreaming: drm expected "${step.drm}", got "${drmType ?? 'none'}"`)
        }
    }

    /**
     * Validates the Roku home-screen channel tile order against an expected list.
     *
     * Fetches `/query/apps` and compares each app name at the corresponding position.
     * Throws on the first mismatch.
     */
    private async execChannelTileOrder(step: ChannelTileOrderStep, ip: string): Promise<void> {
        const xml = await ecpRequest(ip, 'GET', '/query/apps')
        const parsed = xmlParser.parse(xml)
        const apps: unknown[] = parsed?.apps?.app ?? []

        const names = apps.map((appElement: unknown) => {
            const app = appElement as Record<string, unknown>
            return typeof app === 'string' ? app : String(app?.['#text'] ?? app?.name ?? '')
        })

        for (let i = 0; i < step.channels.length; i++) {
            const expected = step.channels[i]
            const actual = names[i]
            if (actual !== expected) {
                throw new Error(`channelTileOrder: position ${i + 1} expected "${expected}", got "${actual ?? 'none'}"`)
            }
        }
    }

    /**
     * Polls `/query/active-app` until the active app ID matches `step.appId`
     * or the configured timeout elapses.
     *
     * @throws If the app does not become active within the timeout.
     */
    private async execWaitActiveApp(step: WaitActiveAppStep, ip: string): Promise<void> {
        const intervalMs = step.intervalMs ?? DEFAULT_POLL_INTERVAL_MS
        const timeoutMs = step.timeoutMs ?? DEFAULT_TIMEOUT_MS
        const deadline = Date.now() + timeoutMs

        while (Date.now() < deadline) {
            if (this.stopRequested) throw new StopSignal()
            const app = await this.ecp.queryActiveApp(ip)
            if (app.id === step.appId) return
            await sleep(Math.min(intervalMs, deadline - Date.now()))
        }

        throw new Error(`waitActiveApp timeout: app "${step.appId}" did not become active within ${timeoutMs}ms`)
    }

    /**
     * Fetches an arbitrary ECP endpoint and asserts that a dot-notation field in the
     * parsed XML response equals the expected string value.
     *
     * @throws If the field value does not match `step.expected`.
     */
    private async execAssertQuery(step: AssertQueryStep, ip: string): Promise<void> {
        const xml = await ecpRequest(ip, 'GET', step.endpoint)
        const parsed = xmlParser.parse(xml)

        const actual = getNestedField(parsed, step.field)
        if (String(actual) !== step.expected) {
            throw new Error(`assertQuery "${step.field}": expected "${step.expected}", got "${actual}"`)
        }
    }

    // -- Log persistence -------------------------------------------------------

    /**
     * Writes the completed `ExecutionLog` to `<userData>/scripts/logs/<timestamp>.json`.
     * Failure is silently swallowed so a disk error cannot crash the engine.
     *
     * @param log - The log to persist.
     */
    private persistLog(log: ExecutionLog): void {
        try {
            const logsDir = path.join(app.getPath('userData'), 'scripts', 'logs')
            fs.mkdirSync(logsDir, { recursive: true })
            const filename = `${Date.now()}.json`
            fs.writeFileSync(path.join(logsDir, filename), JSON.stringify(log, null, 2), 'utf-8')
        } catch {
            // Non-fatal - log failure should not crash the engine
        }
    }
}

// -- Helpers -------------------------------------------------------------------

/** Compile-time exhaustiveness check. TypeScript narrows `x` to `never` only when every
 *  case in the enclosing switch is handled; an unhandled case causes a build error. */
function assertNever(x: never): never {
    throw new Error(`Unhandled step type: ${JSON.stringify(x)}`)
}

class StopSignal extends Error { constructor() { super('stopped') } }
class SkipSignal extends Error { constructor() { super('skip') } }

/**
 * Returns a promise that resolves after `ms` milliseconds.
 * Negative values are treated as zero.
 *
 * @param ms - Duration in milliseconds.
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)))
}


/**
 * Reads a value from a nested object using a dot-separated path string.
 *
 * @param obj - The root object to traverse.
 * @param dotPath - A dot-separated field path, e.g. `"player.position"`.
 * @returns The value at the path, or `undefined` if any segment is missing.
 */
function getNestedField(obj: unknown, dotPath: string): unknown {
    const parts = dotPath.split('.')
    let cur: unknown = obj
    for (const part of parts) {
        if (cur === null || cur === undefined || typeof cur !== 'object') return undefined
        cur = (cur as Record<string, unknown>)[part]
    }
    return cur
}
