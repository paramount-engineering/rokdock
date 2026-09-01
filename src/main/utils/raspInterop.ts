/**
 * RASP (Roku Automation Script Protocol) import/export bridge.
 *
 * Converts between the RASP YAML format used by Roku's official Remote Automation
 * Script Player and RokDock's internal JSON ScriptFile format.
 *
 * Import (importRasp): parses YAML, maps RASP step types to internal Step types,
 *   records warnings for unsupported constructs (partner keys, unknown step types),
 *   and preserves unknown steps as UnknownStep for display without data loss.
 *
 * Export (exportRasp): maps internal steps back to RASP YAML format. Steps that
 *   have no RASP equivalent (block definitions, assertQuery, waitActiveApp, etc.)
 *   are silently skipped; the return value includes a warnings array for the UI.
 *
 * Known RASP quirks handled at this boundary:
 *  - rasp_version is sometimes a quoted string rather than an integer.
 *  - Partner keys (Netflix, Hulu, etc.) are valid in the YAML but fail at runtime.
 *  - The 'Sling TV ' partner key has a trailing space - a bug in RASP source that
 *    must be preserved for correct round-trip compatibility.
 *  - YAML anchor/alias syntax is supported via js-yaml's native handling.
 */

// RASP interop: import RASP YAML -> internal JSON, export internal JSON -> RASP YAML.
// RASP (Roku Automation Script Protocol) has several documented bugs handled at the boundary.
// See tasks/rasp-schema-reference.md for the full reference.

import { load as loadYaml, dump as dumpYaml } from 'js-yaml'
import type {
    ScriptFile, Step, RaspMetadata, StepAnnotation,
    PressStep, DelayStep, LaunchStep, LoopStep,
    WaitPlayerStateStep, ValidateStreamingStep, ChannelTileOrderStep, ScreenshotStep, UnknownStep,
    CommentStep, BlockDefinitionStep, BlockReferenceStep
} from '../../shared/script'
import { RASP_EXECUTION_KEY_SET, RASP_PARTNER_KEY_SET, RASP_KEY_TO_ECP, ECP_TO_RASP } from '../../shared/raspKeys'

// -- Import --------------------------------------------------------------------

interface ImportResult {
    script: ScriptFile
    warnings: string[]
}

/**
 * True when a path is a RASP source file (loaded via importRasp), as opposed to a
 * native RokDock script. `.yaml`/`.yml` are accepted for the explicit `--tool script`
 * path even though only `.rasp` is OS-associated. This set is deliberately broader
 * than `toolForFile` in launchRequest.ts (which omits `.yaml`/`.yml` as too generic
 * to claim). See that function's doc for the asymmetry.
 */
export function isRaspFile(filePath: string): boolean {
    const lower = filePath.toLowerCase()
    return lower.endsWith('.rasp') || lower.endsWith('.yaml') || lower.endsWith('.yml')
}

/**
 * Parses a RASP YAML document and converts it to RokDock's internal ScriptFile format.
 *
 * Handles RASP quirks such as quoted rasp_version, flat params blocks, CRLF line
 * endings, tab indentation, and YAML anchor/alias syntax. Unknown step types are
 * preserved as UnknownStep rather than silently dropped. Warnings are accumulated
 * for non-fatal issues (unsupported constructs, coerced values) and returned alongside
 * the parsed script so the UI can surface them to the user.
 *
 * @param yamlText - Raw RASP YAML string content.
 * @param name - Display name assigned to the resulting ScriptFile. Defaults to 'Imported Script'.
 * @returns ImportResult containing the converted script and any accumulated warnings.
 * @throws If the YAML cannot be parsed or the document is not a valid RASP object.
 */
export function importRasp(yamlText: string, name = 'Imported Script'): ImportResult {
    const warnings: string[] = []

    // Resolve YAML anchor/alias syntax before parsing - js-yaml handles this natively
    // but we pre-process to expand them for display (showing inline in step list)
    let parsed: unknown
    try {
        parsed = loadYaml(preprocessRasp(yamlText))
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(`RASP parse error: ${msg}`)
    }

    if (!parsed || typeof parsed !== 'object') {
        throw new Error('RASP parse error: document is empty or not an object')
    }

    const doc = parsed as Record<string, unknown>
    const params = (doc.params ?? {}) as Record<string, unknown>

    // Coerce quoted rasp_version string to int
    let raspVersion = params.rasp_version
    if (typeof raspVersion === 'string') {
        raspVersion = parseInt(raspVersion, 10)
        warnings.push('rasp_version was a quoted string - coerced to integer')
    }

    const metadata: RaspMetadata = {
        raspVersion: typeof raspVersion === 'number' ? raspVersion : 1,
        defaultKeypressWait: typeof params.default_keypress_wait === 'number' ? params.default_keypress_wait : undefined,
        channelName: typeof params.channel_name === 'string' ? params.channel_name : undefined,
        channelId: params.channel_id as string | number | undefined,
        channels: params.channels as Record<string, number> | string[] | undefined,
    }

    if (doc.requirements) {
        metadata.requirements = doc.requirements as Record<string, unknown>
        warnings.push('requirements block is stored as metadata but is ignored by RASP at runtime')
    }

    const channelsMap = (metadata.channels && !Array.isArray(metadata.channels))
        ? metadata.channels as Record<string, number>
        : undefined

    const rawSteps = Array.isArray(doc.steps) ? doc.steps : []
    const steps: Step[] = rawSteps.map((raw, i) => {
        try {
            return convertRaspStep(raw, warnings, channelsMap)
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            warnings.push(`Step ${i + 1}: ${msg}`)
            return {
                type: 'unknown',
                raw: typeof raw === 'string' ? raw : JSON.stringify(raw),
                annotations: [{ level: 'error', message: msg }]
            } as UnknownStep
        }
    })

    const script: ScriptFile = {
        version: 1,
        name,
        raspMode: true,
        metadata,
        steps
    }

    return { script, warnings }
}

// Pre-process RASP YAML before parsing.
// Handles common quirks in RASP files generated by various tools:
// - CRLF line endings
// - Tabs used for indentation (YAML disallows tabs)
// - Flat params block: params keys written at root level without indentation under "params:"
/**
 * Normalizes a raw RASP YAML string before passing it to js-yaml.
 * Fixes CRLF line endings, replaces tabs and non-breaking spaces with regular spaces,
 * repairs flat params blocks, and rewrites YAML anchor/alias syntax into a form that
 * survives js-yaml parsing with block identity intact.
 *
 * @param yaml - Raw RASP YAML text as read from disk or a clipboard paste.
 * @returns Normalized YAML string ready for js-yaml.load().
 */
function preprocessRasp(yaml: string): string {
    // Normalize line endings
    let text = yaml.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

    // Replace tabs and non-breaking spaces (U+00A0) with regular spaces.
    // Some RASP editors (e.g. Roku's own tooling) emit non-breaking spaces for indentation,
    // which js-yaml rejects as invalid YAML whitespace.
    text = text.replace(/\t/g, '    ').replace(/\u00a0/g, ' ')

    // Handle flat params block: if "params:" is a line on its own and the following
    // lines are not indented (common in some RASP generators), indent them.
    text = fixFlatParamsBlock(text)

    text = preprocessBlockAnchors(text)

    return text
}

/**
 * Repairs a RASP file where the params block keys are written at root indentation
 * instead of indented under the 'params:' key. This is a known quirk produced by
 * some RASP generators. Detects the unindented params body and adds 2-space indentation
 * up to the next root-level key (steps: or requirements:).
 *
 * @param yaml - YAML text that may contain a flat params block.
 * @returns YAML text with the params block correctly indented, or the original if already valid.
 */
function fixFlatParamsBlock(yaml: string): string {
    const lines = yaml.split('\n')
    const paramsIdx = lines.findIndex(line => /^params:\s*$/.test(line))
    if (paramsIdx === -1) return yaml

    // Check if the line immediately after params: is NOT indented
    const nextIdx = paramsIdx + 1
    if (nextIdx >= lines.length) return yaml
    const nextLine = lines[nextIdx]
    if (!nextLine || /^\s/.test(nextLine) || nextLine.trim() === '') return yaml

    // The params block is flat - find where it ends (next root-level key)
    // Root-level keys: lines starting with a non-space, non-comment character followed by ':'
    const rootKeyRe = /^[a-zA-Z_][a-zA-Z0-9_]*\s*:/
    let endIdx = lines.length
    for (let i = nextIdx; i < lines.length; i++) {
        const line = lines[i]
        if (line.trim() === '' || !rootKeyRe.test(line)) continue
        // Check if this is a known top-level RASP key (not a params key)
        if (/^steps\s*:/.test(line) || /^requirements\s*:/.test(line)) {
            endIdx = i
            break
        }
    }

    // Indent the params block lines by 2 spaces
    const result = [...lines]
    for (let i = nextIdx; i < endIdx; i++) {
        if (result[i].trim() !== '') {
            result[i] = '  ' + result[i]
        }
    }
    return result.join('\n')
}

// Pre-process YAML anchor/alias syntax in the steps array before js-yaml parsing.
// Converts "- *name" aliases to inline objects with a block_ref key (since js-yaml would
// resolve them to the full anchored object, losing alias identity).
// Injects "_block_def: name" into the first property of anchored step mappings so the
// anchor name survives parsing.
/**
 * Rewrites YAML anchor and alias lines in the steps array before js-yaml parsing
 * so that block identity survives the parse step.
 *
 * js-yaml resolves aliases to deep copies of the anchored value, losing the alias
 * identity needed to emit YAML anchors on re-export. This function:
 *  - Converts alias lines ("- *name") to inline mappings ("- {block_ref: "name"}").
 *  - Injects a "_block_def: name" property into the first mapping of anchored steps
 *    ("- &name") so the anchor name is available as a regular field after parsing.
 *
 * @param yaml - YAML text that may contain YAML anchor/alias syntax in the steps array.
 * @returns YAML text with anchors/aliases rewritten to survive js-yaml parsing.
 */
function preprocessBlockAnchors(yaml: string): string {
    const lines = yaml.split('\n')
    const result: string[] = []

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]

        // Alias line: "  - *anchorName" -> "  - {block_ref: "anchorName"}"
        const aliasMatch = line.match(/^(\s*)-\s+\*([a-zA-Z0-9_]+)\s*$/)
        if (aliasMatch) {
            result.push(aliasMatch[1] + '- {block_ref: "' + aliasMatch[2] + '"}')
            continue
        }

        // Anchor line: "  - &anchorName" (anchor on the list item header)
        const anchorMatch = line.match(/^(\s*)-\s+&([a-zA-Z0-9_]+)\s*$/)
        if (anchorMatch) {
            result.push(line)
            // Find indentation of next non-empty line to determine property indent
            let nextNonEmpty = ''
            for (let j = i + 1; j < lines.length; j++) {
                if (lines[j].trim()) { nextNonEmpty = lines[j]; break }
            }
            const propIndent = (nextNonEmpty.match(/^(\s+)/) || ['', anchorMatch[1] + '  '])[1]
            result.push(propIndent + '_block_def: "' + anchorMatch[2] + '"')
            continue
        }

        result.push(line)
    }

    return result.join('\n')
}

/**
 * Attaches an onError handler to a converted step if the raw RASP step contains
 * an 'on_error' key. Handles both the 'ignore' shorthand (maps to an empty array)
 * and full step-array form. Unrecognized sub-steps in on_error are wrapped as
 * UnknownStep with an error annotation rather than causing the import to fail.
 *
 * @param parsed - The already-converted internal Step object.
 * @param raw - The original raw RASP step object, potentially containing 'on_error'.
 * @param warnings - Mutable warnings array to append any on_error conversion issues to.
 * @param channelsMap - Optional channel name-to-ID map from the RASP params block.
 * @returns The parsed step unchanged, or a new step object with the onError field added.
 */
function addOnError(
    parsed: Step,
    raw: Record<string, unknown>,
    warnings: string[],
    channelsMap?: Record<string, number>
): Step {
    if (!('on_error' in raw)) return parsed
    if (raw.on_error === 'ignore') return { ...parsed, onError: [] } as Step
    if (!Array.isArray(raw.on_error)) return parsed
    const onError: Step[] = (raw.on_error as unknown[]).map((step: unknown) => {
        try { return convertRaspStep(step, warnings, channelsMap) }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            warnings.push('on_error step: ' + msg)
            return { type: 'unknown', raw: JSON.stringify(step), annotations: [{ level: 'error', message: msg }] } as UnknownStep
        }
    })
    return { ...parsed, onError } as Step
}

/**
 * Converts a single raw RASP step value (object or string shorthand) to an internal Step.
 * Handles block-ref, block-def, and all standard RASP step types. Throws on unknown types
 * so the caller (importRasp) can wrap the error as an UnknownStep with an annotation.
 *
 * @param raw - The raw step value from the parsed YAML document.
 * @param warnings - Mutable warnings array for non-fatal issues (unrecognized keys, partner keys, etc.).
 * @param channelsMap - Optional channel name-to-ID map for resolving launch steps.
 * @returns Converted internal Step.
 * @throws If the step type is unrecognized or the value is not an object or known shorthand string.
 */
function convertRaspStep(raw: unknown, warnings: string[], channelsMap?: Record<string, number>): Step {
    if (typeof raw === 'string') {
        // Short form: "- press: home" parsed as { press: 'home' } OR "- press" as string
        // At top level strings are action names like "launch" or "validate_streaming"
        if (raw === 'launch') return convertLaunchStep(null, warnings, channelsMap)
        if (raw === 'validate_streaming') return convertValidateStep(null, warnings)
        if (raw === 'channel_tile_order') throw new Error('channel_tile_order requires a channels list')
        throw new Error(`Unexpected string step: "${raw}"`)
    }

    if (!raw || typeof raw !== 'object') {
        throw new Error('Step must be an object')
    }

    const step = raw as Record<string, unknown>

    // Block reference (from preprocessed alias)
    if ('block_ref' in step) {
        const result: Step = { type: 'block-ref', name: String(step.block_ref) }
        return addOnError(result, step, warnings, channelsMap)
    }

    // Block definition (from preprocessed anchor)
    if ('_block_def' in step) {
        const name = String(step._block_def)
        const rawSteps = Array.isArray(step.step) ? step.step : []
        const steps: Step[] = rawSteps.map((step: unknown) => {
            try {
                return convertRaspStep(step, warnings, channelsMap)
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err)
                warnings.push('Block "' + name + '": ' + msg)
                return { type: 'unknown', raw: JSON.stringify(step), annotations: [{ level: 'error', message: msg }] } as UnknownStep
            }
        })
        const parsed: Step = { type: 'block', name, steps }
        return addOnError(parsed, step, warnings, channelsMap)
    }

    let parsed: Step
    if ('press' in step) parsed = convertPressStep(step.press, step, warnings)
    else if ('text' in step) parsed = { type: 'text', value: String(step.text ?? '') }
    else if ('pause' in step) parsed = convertPauseStep(step.pause)
    else if ('launch' in step) parsed = convertLaunchStep(step as Record<string, unknown>, warnings, channelsMap)
    else if ('loop' in step) parsed = convertLoopStep(step as Record<string, unknown>, warnings, channelsMap)
    else if ('wait_for_player_state' in step) parsed = convertWaitPlayerState(step.wait_for_player_state)
    else if ('validate_streaming' in step) parsed = convertValidateStep(step as Record<string, unknown>, warnings)
    else if ('channel_tile_order' in step) parsed = convertChannelTileOrder(step as Record<string, unknown>)
    else if ('screenshot' in step) parsed = { type: 'screenshot', marker: String(step.screenshot ?? '') }
    else throw new Error(`Unknown RASP step type: ${Object.keys(step).join(', ')}`)

    return addOnError(parsed, step, warnings, channelsMap)
}

/**
 * Converts a RASP press step to an internal PressStep. Translates the RASP key name to
 * its ECP equivalent via RASP_KEY_TO_ECP. Adds annotations and warnings for partner keys
 * (which fail at RASP runtime) and unrecognized key names.
 *
 * @param keyValue - The value of the RASP 'press' field.
 * @param step - The full raw RASP step object (used for future field access).
 * @param warnings - Mutable warnings array.
 * @returns Internal PressStep with the ECP key name and any annotations.
 */
function convertPressStep(keyValue: unknown, step: Record<string, unknown>, warnings: string[]): PressStep {
    const raspKey = String(keyValue ?? '').trim()
    const annotations: StepAnnotation[] = []

    if (RASP_PARTNER_KEY_SET.has(raspKey)) {
        const msg = 'Partner key presses are recorded in the UI but fail at RASP runtime'
        annotations.push({ level: 'warning', message: msg })
        warnings.push(`press "${raspKey}": ${msg}`)
    } else if (!RASP_EXECUTION_KEY_SET.has(raspKey)) {
        const msg = `"${raspKey}" is not a recognized RASP execution engine key`
        annotations.push({ level: 'warning', message: msg })
        warnings.push(`press "${raspKey}": ${msg}`)
    }

    // Store ECP key internally so the engine and key editor work without conversion.
    // Partner keys have no meaningful ECP equivalent so they stay as their RASP name.
    const internalKey = RASP_KEY_TO_ECP.get(raspKey) ?? raspKey

    return { type: 'press', key: internalKey, ...(annotations.length ? { annotations } : {}) }
}

/**
 * Converts a RASP pause step (duration in seconds) to an internal DelayStep (duration in ms).
 *
 * @param value - The RASP pause value; a number is used directly, strings are parsed.
 * @returns Internal DelayStep with durationMs set.
 */
function convertPauseStep(value: unknown): Step {
    const seconds = typeof value === 'number' ? value : parseFloat(String(value ?? '0'))
    const durationMs = Math.round(seconds * 1000)
    // Number.isFinite rejects NaN, Infinity, and -Infinity in one check.
    return { type: 'delay', durationMs: !Number.isFinite(durationMs) || durationMs < 0 ? 0 : durationMs }
}

/**
 * Converts a RASP launch step to an internal LaunchStep. Resolves the channel ID from
 * the params.channels map when the step uses the shorthand "- launch: ChannelName" form.
 *
 * @param step - The raw RASP step object, or null for the bare "launch" string shorthand.
 * @param warnings - Mutable warnings array (unused currently; present for consistency).
 * @param channelsMap - Optional channel name-to-ID map from the RASP params block.
 * @returns Internal LaunchStep with optional channelName and channelId.
 */
function convertLaunchStep(step: Record<string, unknown> | null, warnings: string[], channelsMap?: Record<string, number>): LaunchStep {
    if (!step) return { type: 'launch' }

    // Explicit channel_name/channel_id properties (e.g. from our own export format)
    let channelName = step.channel_name !== undefined ? String(step.channel_name) : undefined
    let channelId = step.channel_id as string | number | undefined

    // "- launch: ChannelName" - the channel name is the value of the launch key,
    // and the ID is resolved from the params.channels map
    if (!channelName && !channelId && step.launch != null && step.launch !== '') {
        channelName = String(step.launch)
        if (channelsMap && channelName in channelsMap) {
            channelId = channelsMap[channelName]
        }
    }

    return { type: 'launch', channelName, channelId }
}

/**
 * Converts a RASP loop step to an internal LoopStep. Recursively converts the nested
 * steps array using convertRaspStep and attaches any on_error handler.
 *
 * @param step - The raw RASP step object containing 'loop' and 'iterations'/'steps'.
 * @param warnings - Mutable warnings array propagated to nested step conversion.
 * @param channelsMap - Optional channel name-to-ID map propagated to nested steps.
 * @returns Internal LoopStep.
 */
function convertLoopStep(step: Record<string, unknown>, warnings: string[], channelsMap?: Record<string, number>): LoopStep {
    const loopBody = (step.loop ?? step) as Record<string, unknown>
    const rawIterations = loopBody.iterations
    const iterations = (typeof rawIterations === 'number' && Number.isFinite(rawIterations) && rawIterations >= 0)
        ? Math.floor(rawIterations)
        : 1
    const rawSteps = Array.isArray(loopBody.steps) ? loopBody.steps : []
    const steps: Step[] = rawSteps.map((step: unknown) => convertRaspStep(step, warnings, channelsMap))
    const base: LoopStep = { type: 'loop', iterations, steps }
    return addOnError(base, loopBody, warnings, channelsMap) as LoopStep
}

/**
 * Converts a RASP wait_for_player_state step to an internal WaitPlayerStateStep.
 * Accepts either a bare state string or an object with 'state' and optional 'timeout' (seconds).
 * The timeout is converted from seconds to milliseconds for internal storage.
 *
 * @param value - The RASP wait_for_player_state field value.
 * @returns Internal WaitPlayerStateStep with normalized state and optional timeoutMs.
 */
function convertWaitPlayerState(value: unknown): WaitPlayerStateStep {
    if (typeof value === 'string') {
        return { type: 'waitPlayerState', state: normalizePlayerState(value) }
    }
    if (value && typeof value === 'object') {
        const valueObj = value as Record<string, unknown>
        const state = normalizePlayerState(String(valueObj.state ?? 'stop'))
        const timeoutMs = typeof valueObj.timeout === 'number' ? valueObj.timeout * 1000 : undefined
        return { type: 'waitPlayerState', state, ...(timeoutMs !== undefined ? { timeoutMs } : {}) }
    }
    return { type: 'waitPlayerState', state: 'play' }
}

/**
 * Maps a raw RASP player state string to the canonical WaitPlayerStateStep state enum value.
 * Defaults to 'stop' for any unrecognized value.
 *
 * @param raw - The raw state string from the RASP YAML (case-insensitive).
 * @returns Canonical player state: 'play', 'pause', 'stop', or 'buffering'.
 */
function normalizePlayerState(raw: string): WaitPlayerStateStep['state'] {
    switch (raw.toLowerCase()) {
        case 'play': return 'play'
        case 'pause': return 'pause'
        case 'stop': return 'stop'
        case 'buffering': return 'buffering'
        default: return 'stop'
    }
}

/**
 * Converts a RASP validate_streaming step to an internal ValidateStreamingStep.
 * Maps snake_case RASP field names (audio_codec, video_codec, drm, skip_bitrate, audio_only)
 * to their camelCase internal equivalents. All fields are optional.
 *
 * @param step - The raw RASP step object, or null for the bare "validate_streaming" shorthand.
 * @param warnings - Mutable warnings array (unused currently; present for consistency).
 * @returns Internal ValidateStreamingStep.
 */
function convertValidateStep(step: Record<string, unknown> | null, warnings: string[]): Step {
    const annotations: StepAnnotation[] = []
    if (!step) return { type: 'validateStreaming' }

    const body = (step.validate_streaming ?? step) as Record<string, unknown> | null

    if (!body || typeof body !== 'object') {
        return { type: 'validateStreaming' }
    }

    const audioCodec = typeof body.audio_codec === 'string' ? body.audio_codec : undefined
    const videoCodec = typeof body.video_codec === 'string' ? body.video_codec : undefined
    const drm = typeof body.drm === 'string' ? body.drm : undefined
    const skipBitrateValidation = body.skip_bitrate === true ? true : undefined
    const skipVideoValidation = body.audio_only === true ? true : undefined

    return {
        type: 'validateStreaming',
        ...(audioCodec !== undefined ? { audioCodec } : {}),
        ...(videoCodec !== undefined ? { videoCodec } : {}),
        ...(drm !== undefined ? { drm } : {}),
        ...(skipBitrateValidation ? { skipBitrateValidation } : {}),
        ...(skipVideoValidation ? { skipVideoValidation } : {}),
        ...(annotations.length ? { annotations } : {})
    }
}

/**
 * Converts a RASP channel_tile_order step to an internal ChannelTileOrderStep.
 * Each channel in the array is coerced to a string.
 *
 * @param step - The raw RASP step object containing a 'channel_tile_order' array.
 * @returns Internal ChannelTileOrderStep with the channels list.
 */
function convertChannelTileOrder(step: Record<string, unknown>): ChannelTileOrderStep {
    const channels = Array.isArray(step.channel_tile_order) ? step.channel_tile_order.map(String) : []
    return { type: 'channelTileOrder', channels }
}

// -- Export --------------------------------------------------------------------

interface ExportResult {
    yaml: string
    warnings: string[]
}

/**
 * Walks the step tree (loop bodies, block bodies, and on_error handlers included) and
 * collects each launch step's channel name -> id pair. These populate params.channels so
 * the exported `- launch: <ChannelName>` shorthand resolves to an app id at RASP runtime,
 * matching Roku's own script format. A purely numeric id string is coerced to a number so
 * it serializes unquoted (like Roku's tool); a non-numeric id (e.g. 'dev') is left as-is.
 *
 * @param steps - Internal steps to scan.
 * @param out - Accumulator map (mutated and returned) of channel name to app id.
 * @returns The channel name -> id map.
 */
function collectLaunchChannels(steps: Step[], out: Record<string, string | number> = {}): Record<string, string | number> {
    for (const step of steps) {
        if (step.type === 'launch' && step.channelName && step.channelId !== undefined) {
            const id = step.channelId
            out[step.channelName] = typeof id === 'string' && /^\d+$/.test(id) ? Number(id) : id
        }
        const nested = step as { steps?: Step[]; onError?: Step[] }
        if (Array.isArray(nested.steps)) collectLaunchChannels(nested.steps, out)
        if (Array.isArray(nested.onError)) collectLaunchChannels(nested.onError, out)
    }
    return out
}

/**
 * Converts an internal ScriptFile to RASP YAML format for export.
 *
 * Serializes the params block (rasp_version, channel metadata) and then recurses
 * through the steps via exportStepsToLines. Steps with no RASP equivalent
 * (assertQuery, waitActiveApp, unresolved block types) are silently omitted and
 * their details collected in the returned warnings array.
 *
 * Round-trip note: sub-second delay durations are rounded up to whole seconds,
 * and some internal step types have no RASP equivalent - the export is intentionally
 * lossy for those cases.
 *
 * @param script - Internal ScriptFile to serialize.
 * @returns ExportResult with the YAML string and any omission/conversion warnings.
 */
export function exportRasp(script: ScriptFile): ExportResult {
    const warnings: string[] = []
    const omitted: { index: string; type: string }[] = []

    // Launch steps export as Roku's `- launch: <ChannelName>` shorthand, which resolves
    // the app id from params.channels at runtime. Merge each launch step's name -> id pair
    // into any imported channels map so the shorthand resolves. An object map wins over the
    // legacy array form; the array form is passed through only when no id-bearing entries exist.
    const launchChannels = collectLaunchChannels(script.steps)
    const metaChannels = script.metadata?.channels
    const objectChannels = metaChannels && !Array.isArray(metaChannels) ? metaChannels : undefined
    const mergedChannels: Record<string, string | number> = { ...(objectChannels ?? {}), ...launchChannels }
    const channelsForParams = Object.keys(mergedChannels).length > 0
        ? mergedChannels
        : (Array.isArray(metaChannels) && metaChannels.length > 0 ? metaChannels : undefined)

    const paramsDoc: Record<string, unknown> = {
        params: {
            rasp_version: 1,
            ...(script.metadata?.defaultKeypressWait !== undefined ? { default_keypress_wait: script.metadata.defaultKeypressWait } : {}),
            ...(script.metadata?.channelName ? { channel_name: script.metadata.channelName } : {}),
            ...(script.metadata?.channelId !== undefined ? { channel_id: script.metadata.channelId } : {}),
            ...(channelsForParams ? { channels: channelsForParams } : {}),
        }
    }
    const paramsYaml = dumpYaml(paramsDoc, { lineWidth: 120, noRefs: true }).trimEnd()
    // Ensure rasp_version is unquoted integer
    const fixedParamsYaml = paramsYaml.replace(/rasp_version:\s*['"]1['"]/g, 'rasp_version: 1')

    const stepLines: string[] = ['steps:']
    exportStepsToLines(script.steps, stepLines, warnings, omitted, '', '  ')

    if (omitted.length > 0) {
        warnings.push(
            `${omitted.length} step(s) have no RASP equivalent and were omitted: ` +
            omitted.map(omittedStep => `step ${omittedStep.index} (${omittedStep.type})`).join(', ')
        )
    }

    const yaml = fixedParamsYaml + '\n' + stepLines.join('\n') + '\n'
    return { yaml, warnings }
}

// Used by convertToRaspStep (loop case) to serialize disabled loop body steps into
// a flat unknown[] for the RASP loop.steps array when the loop itself is not disabled.
/**
 * Converts an array of internal Steps to RASP-compatible unknown values and appends
 * them to the output array. Used by convertToRaspStep (loop body case) where the
 * output needs to be a plain array rather than YAML line strings.
 *
 * @param steps - Internal steps to serialize.
 * @param out - Mutable output array to append converted RASP step objects to.
 * @param warnings - Mutable warnings array for conversion issues.
 * @param omitted - Mutable list of steps that could not be represented in RASP.
 * @param prefix - Label prefix for step numbering in warnings (e.g. '2.1').
 */
function exportSteps(
    steps: Step[],
    out: unknown[],
    warnings: string[],
    omitted: { index: string; type: string }[],
    prefix: string
): void {
    steps.forEach((step, i) => {
        const label = prefix ? `${prefix}.${i + 1}` : String(i + 1)
        const raspStep = convertToRaspStep(step, label, warnings, omitted)
        if (raspStep !== null) out.push(raspStep)
    })
}

/**
 * Appends the on_error YAML lines for a step if an onError handler is defined.
 * An empty array is emitted as 'on_error: ignore'; a non-empty array is serialized
 * recursively using exportStepsToLines.
 *
 * @param onError - The step's onError handler array, or undefined to skip emission.
 * @param lines - Mutable YAML line array to append to.
 * @param warnings - Mutable warnings array propagated to nested step serialization.
 * @param omitted - Mutable omitted-steps list propagated to nested step serialization.
 * @param label - Step label prefix for numbering in warnings.
 * @param indent - Current indentation string for the parent step.
 */
function emitOnError(
    onError: Step[] | undefined,
    lines: string[],
    warnings: string[],
    omitted: { index: string; type: string }[],
    label: string,
    indent: string
): void {
    if (onError === undefined) return
    if (onError.length === 0) {
        lines.push(indent + '  on_error: ignore')
    } else {
        lines.push(indent + '  on_error:')
        exportStepsToLines(onError, lines, warnings, omitted, label + '.e', indent + '    ')
    }
}

/**
 * Normalize a block name into a YAML-anchor-safe token: lowercased, whitespace and
 * any non-alphanumeric character collapsed to underscores.
 */
function normalizeAnchorName(name: string): string {
    return name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '_')
}

/**
 * Recursively serializes an array of internal Steps into YAML line strings, handling
 * disabled steps (emitted as YAML comments), block definitions (with YAML anchors),
 * block references (with YAML aliases), comment steps, and all standard RASP step types.
 *
 * Loops are serialized inline rather than via convertToRaspStep to preserve nested
 * comment and disabled step handling within the loop body.
 *
 * @param steps - Internal steps to serialize.
 * @param lines - Mutable YAML line array to append to.
 * @param warnings - Mutable warnings array for conversion issues.
 * @param omitted - Mutable list of steps that could not be represented in RASP.
 * @param prefix - Label prefix for step numbering in warnings.
 * @param indent - Indentation string to prepend to each emitted line.
 */
function exportStepsToLines(
    steps: Step[],
    lines: string[],
    warnings: string[],
    omitted: { index: string; type: string }[],
    prefix: string,
    indent: string
): void {
    steps.forEach((step, i) => {
        const label = prefix ? `${prefix}.${i + 1}` : String(i + 1)

        // block-ref: emit as YAML alias
        if (step.type === 'block-ref') {
            const blockRef = step as BlockReferenceStep
            const anchorName = normalizeAnchorName(blockRef.name)
            lines.push(indent + '- *' + anchorName)
            return
        }

        // block definition: emit with YAML anchor
        if (step.type === 'block') {
            const block = step as BlockDefinitionStep & { onError?: Step[] }
            const anchorName = normalizeAnchorName(block.name)
            lines.push(indent + '- &' + anchorName)
            lines.push(indent + '  step:')
            exportStepsToLines(block.steps, lines, warnings, omitted, label, indent + '    ')
            const disabled = (step as Step & { disabled?: boolean }).disabled
            if (!disabled) emitOnError(block.onError, lines, warnings, omitted, label, indent)
            return
        }

        // comment step: export as YAML comment line
        if (step.type === 'comment') {
            lines.push(indent + '# ' + (step as CommentStep).text)
            return
        }

        const disabled = (step as Step & { disabled?: boolean }).disabled
        // Strip disabled field before serializing
        const { disabled: _d, ...coreStep } = step as Step & { disabled?: boolean }

        // Non-disabled loop: recurse to support nested comment/disabled steps
        if ((coreStep as Step).type === 'loop' && !disabled) {
            const loop = coreStep as LoopStep
            lines.push(indent + '- loop:')
            lines.push(indent + '  iterations: ' + loop.iterations)
            lines.push(indent + '  steps:')
            exportStepsToLines(loop.steps, lines, warnings, omitted, label, indent + '    ')
            emitOnError(loop.onError, lines, warnings, omitted, label, indent)
            return
        }

        const raspObj = convertToRaspStep(coreStep as Step, label, warnings, omitted)
        if (raspObj === null) return

        const itemLines = dumpYaml([raspObj], { lineWidth: 120, noRefs: true })
            .split('\n')
            .filter(line => line.trim())

        for (const line of itemLines) {
            lines.push(disabled ? indent + '# ' + line : indent + line)
        }

        if (!disabled) emitOnError((coreStep as Step & { onError?: Step[] }).onError, lines, warnings, omitted, label, indent)
    })
}

/**
 * Converts a single internal Step to its RASP YAML-serializable object representation.
 * Returns null for step types that have no RASP equivalent (assertQuery, waitActiveApp,
 * block, block-ref when reached directly); those are added to the omitted list.
 *
 * @param step - Internal Step to convert.
 * @param label - Human-readable step label for use in warnings (e.g. '3.2').
 * @param warnings - Mutable warnings array for conversion issues (e.g. unmappable keys).
 * @param omitted - Mutable list of steps that have no RASP equivalent.
 * @returns RASP-compatible value for serialization by js-yaml, or null to skip the step.
 */
function convertToRaspStep(
    step: Step,
    label: string,
    warnings: string[],
    omitted: { index: string; type: string }[]
): unknown {
    switch (step.type) {
        case 'press': {
            // Internal key is ECP format; convert to RASP for export
            const raspKey = ECP_TO_RASP.get(step.key)
            if (raspKey) {
                return { press: raspKey }
            }
            // Partner keys are stored by RASP name (no ECP equivalent)
            if (RASP_PARTNER_KEY_SET.has(step.key)) {
                warnings.push(`Step ${label}: press "${step.key}" is a partner key that will fail at RASP runtime`)
                return { press: step.key }
            }
            omitted.push({ index: label, type: `press:${step.key}` })
            warnings.push(`Step ${label}: press key "${step.key}" has no RASP equivalent - omitted`)
            return null
        }

        case 'text':
            return { text: step.value }

        case 'delay': {
            // Export rounds up to whole seconds with a 1s minimum for RASP runtime compatibility.
            // Import uses exact milliseconds - the round-trip is intentionally lossy for sub-second values.
            const seconds = Math.max(1, Math.ceil(step.durationMs / 1000))
            return { pause: seconds }
        }

        case 'launch': {
            // Roku's shorthand: `- launch: <ChannelName>`, with the name -> id pair carried
            // in params.channels (populated by collectLaunchChannels). Fall back to an
            // explicit channel_id only when there is no name to key the channels map on,
            // and to the bare `launch` action when neither is set.
            if (step.channelName) return { launch: step.channelName }
            if (step.channelId !== undefined) return { launch: null, channel_id: step.channelId }
            return 'launch'
        }

        case 'loop': {
            const nestedSteps: unknown[] = []
            exportSteps(step.steps, nestedSteps, warnings, omitted, label)
            return { loop: null, iterations: step.iterations, steps: nestedSteps }
        }

        case 'waitPlayerState': {
            const state = step.state === 'buffering' || step.state === 'finished' ? 'play' : step.state
            if (step.timeoutMs !== undefined) {
                return { wait_for_player_state: { state, timeout: Math.ceil(step.timeoutMs / 1000) } }
            }
            return { wait_for_player_state: state }
        }

        case 'validateStreaming': {
            const obj: Record<string, unknown> = {}
            if (step.audioCodec !== undefined) obj.audio_codec = step.audioCodec
            if (step.videoCodec !== undefined) obj.video_codec = step.videoCodec
            if (step.drm !== undefined) obj.drm = step.drm
            if (step.skipBitrateValidation) obj.skip_bitrate = true
            if (step.skipVideoValidation) obj.audio_only = true
            return Object.keys(obj).length ? { validate_streaming: null, ...obj } : 'validate_streaming'
        }

        case 'channelTileOrder':
            return { channel_tile_order: step.channels }

        case 'screenshot':
            return { screenshot: step.marker }

        case 'waitActiveApp':
        case 'assertQuery': {
            omitted.push({ index: label, type: step.type })
            return null
        }

        case 'block':
        case 'block-ref':
            // Handled by exportStepsToLines before reaching convertToRaspStep
            omitted.push({ index: label, type: step.type })
            return null

        default:
            return null
    }
}
