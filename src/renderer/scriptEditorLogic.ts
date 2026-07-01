/**
 * Pure (DOM-free) helpers for the Script Editor renderer.
 *
 * All functions here are side-effect free and tested by scriptEditorLogic.test.ts.
 * They were extracted from the original inline script so they can be unit-tested
 * in Vitest without a DOM or Electron environment.
 */

import type { Step, LaunchStep, ScriptFile, RaspMetadata } from '@shared/script'
import { escapeHtml } from '@shared/htmlEscape'
export { escapeHtml } from '@shared/htmlEscape'

// -- Step display helpers -------------------------------------------------------

/**
 * Source-of-truth table for step-type display values.
 *
 * Each entry is [chipKey, stepTypeAttribute]. The two values differ only for
 * waitActiveApp: chipKey is 'wait' (matches the visual style for wait steps)
 * while the data-t attribute is 'other' (intentional divergence kept here so it
 * is visible and tested in one place).
 */
const STEP_TYPE_TABLE: Record<string, [chipKey: string, attribute: string]> = {
    press:             ['press',    'press'],
    key_down:          ['press',    'press'],
    key_up:            ['press',    'press'],
    text:              ['text',     'text'],
    delay:             ['delay',    'delay'],
    launch:            ['launch',   'launch'],
    loop:              ['loop',     'loop'],
    waitPlayerState:   ['wait',     'wait'],
    validateStreaming:  ['validate', 'validate'],
    channelTileOrder:  ['other',    'other'],
    waitActiveApp:     ['wait',     'other'],   // chip=wait, attribute=other (intentional)
    assertQuery:       ['other',    'other'],
    screenshot:        ['other',    'other'],
    comment:           ['comment',  'comment'],
    unknown:           ['error',    'error'],
}

/**
 * Returns the CSS class key used to colour a chip badge for the given step type.
 */
export function chipKey(type: string): string {
    return (STEP_TYPE_TABLE[type]?.[0]) ?? 'other'
}

/**
 * Returns the display label shown inside a chip badge for the given step type.
 */
export function chipLabel(type: string): string {
    const map: Record<string, string> = {
        press: 'PRESS', key_down: 'KEY DN', key_up: 'KEY UP', text: 'TEXT', delay: 'PAUSE',
        launch: 'LAUNCH', loop: 'LOOP', waitPlayerState: 'PLAYER',
        validateStreaming: 'VALIDATE', channelTileOrder: 'TILES', waitActiveApp: 'WAIT APP',
        assertQuery: 'ASSERT', screenshot: 'SCREEN', comment: 'COMMENT', unknown: 'UNKNOWN'
    }
    return map[type] ?? type.toUpperCase()
}

/**
 * Returns the data-t attribute value used to drive left-border colour on step rows.
 */
export function getStepTypeAttribute(type: string): string {
    return (STEP_TYPE_TABLE[type]?.[1]) ?? 'other'
}

/**
 * Returns a dotted display label from an index path, e.g. [0, 1] becomes "1.2".
 */
export function stepLabel(indexPath: number[]): string {
    return indexPath.map(index => index + 1).join('.')
}

// -- Launch channel resolution --------------------------------------------------

interface ResolvedChannel {
    name: string
    id: string
}

/**
 * Resolves the channel name and ID for a launch step.
 * Step-level values take precedence over script metadata channels.
 */
export function resolveLaunchChannel(
    step: LaunchStep,
    metadata?: RaspMetadata
): ResolvedChannel {
    let name: string | undefined = step.channelName
    let id: string | number | undefined = step.channelId

    // Fall back to script metadata channels map (single-entry shorthand used by RASP)
    if (!name && !id && metadata?.channels && !Array.isArray(metadata.channels)) {
        const entries = Object.entries(metadata.channels)
        if (entries.length === 1) {
            name = entries[0][0]
            id = String(entries[0][1])
        }
    }
    return { name: name ?? '', id: id != null ? String(id) : '' }
}

// -- Step summary HTML ----------------------------------------------------------

/**
 * Returns the summary HTML string for display in the step list row.
 * Accepts metadata so launch channel fallback can work in pure logic.
 */
export function stepSummaryHtml(step: Step, metadata?: RaspMetadata): string {
    switch (step.type) {
        case 'press':
        case 'key_down':
        case 'key_up':
            return 'key: <span class="v">' + escapeHtml(step.key) + '</span>'
        case 'text':
            return 'input: <span class="vs">"' + escapeHtml(step.value) + '"</span>'
        case 'delay':
            return '<span class="vn">' + Math.ceil(step.durationMs / 1000) + '</span>s'
        case 'launch': {
            const channel = resolveLaunchChannel(step, metadata)
            if (channel.name && channel.id) {
                return 'app: <span class="v">' + escapeHtml(channel.name) + '</span> <span class="vn">(' + escapeHtml(channel.id) + ')</span>'
            }
            return 'app: <span class="v">' + escapeHtml(channel.name || channel.id || '(none)') + '</span>'
        }
        case 'loop':
            return (step.steps?.length ?? 0) + ' steps'
        case 'waitPlayerState':
            return 'playerState = <span class="vs">"' + escapeHtml(step.state) + '"</span>'
        case 'validateStreaming': {
            const parts: string[] = []
            if (step.audioCodec) parts.push('audio=<span class="vs">' + escapeHtml(step.audioCodec) + '</span>')
            if (step.videoCodec) parts.push('video=<span class="vs">' + escapeHtml(step.videoCodec) + '</span>')
            return parts.join(', ')
        }
        case 'channelTileOrder':
            return '<span class="vd">' + (step.channels ?? []).join(', ') + '</span>'
        case 'waitActiveApp':
            return 'appId: <span class="v">' + escapeHtml(step.appId) + '</span>'
        case 'assertQuery':
            return '<span class="v">' + escapeHtml(step.field) + '</span> = <span class="vs">' + escapeHtml(step.expected) + '</span>'
        case 'screenshot':
            return 'marker: <span class="vs">"' + escapeHtml(step.marker) + '"</span>'
        case 'unknown':
            return '<span class="vd">' + escapeHtml(step.raw) + '</span>'
        case 'comment':
        default:
            return ''
    }
}

// -- RASP detection ------------------------------------------------------------

/**
 * Returns true if the supplied text looks like a RASP YAML script.
 */
export function looksLikeRasp(text: string): boolean {
    return /^\s*steps\s*:/m.test(text)
}

// -- Step migration ------------------------------------------------------------

/**
 * In-place migration of legacy unknown steps that encode screenshots as JSON objects.
 * Mutates the steps array; call once on initial load.
 */
export function migrateSteps(steps: Step[]): void {
    for (let i = 0; i < steps.length; i++) {
        const step = steps[i]
        if (step.type === 'unknown' && step.raw) {
            try {
                const parsed: unknown = JSON.parse(step.raw)
                if (parsed && typeof parsed === 'object' && typeof (parsed as Record<string, unknown>).screenshot === 'string') {
                    steps[i] = { type: 'screenshot', marker: (parsed as Record<string, unknown>).screenshot as string }
                }
            } catch {
                // not JSON, leave as unknown
            }
        }
        if (step.type === 'loop' && step.steps) migrateSteps(step.steps)
    }
}

// -- Block name collection ------------------------------------------------------

/**
 * Collects the names of all block definitions found anywhere in the step tree,
 * recursing into any step that holds a nested steps array (loops and blocks).
 */
export function getBlockNames(steps: Step[]): string[] {
    const blocks: string[] = []
    const scan = (items: Step[]): void => {
        items.forEach(step => {
            if (step.type === 'block') blocks.push((step as { name: string }).name)
            if ((step as { steps?: Step[] }).steps) scan((step as { steps: Step[] }).steps)
        })
    }
    scan(steps)
    return blocks
}

// -- Step sorting helpers ------------------------------------------------------

/** Comparison by descending index to enable safe reverse-order removal. */
export function comparePathsDescending(pathA: (number | string)[], pathB: (number | string)[]): number {
    for (let i = 0; i < Math.min(pathA.length, pathB.length); i++) {
        if (pathA[i] !== pathB[i]) return (pathB[i] as number) - (pathA[i] as number)
    }
    return pathB.length - pathA.length
}

/** Comparison by ascending document order. */
export function comparePathsAscending(pathA: (number | string)[], pathB: (number | string)[]): number {
    for (let i = 0; i < Math.min(pathA.length, pathB.length); i++) {
        if (pathA[i] !== pathB[i]) return (pathA[i] as number) - (pathB[i] as number)
    }
    return pathA.length - pathB.length
}

// -- Blank script factory ------------------------------------------------------

/** Returns a fresh, blank ScriptFile with sensible defaults. */
export function blankScript(): ScriptFile {
    return {
        version: 1,
        name: '(untitled)',
        raspMode: true,
        metadata: { defaultKeypressWait: 1 },
        steps: []
    }
}
