import { describe, it, expect } from 'vitest'
import {
    chipKey,
    chipLabel,
    getStepTypeAttribute,
    stepLabel,
    escapeHtml,
    resolveLaunchChannel,
    stepSummaryHtml,
    looksLikeRasp,
    migrateSteps,
    comparePathsDescending,
    comparePathsAscending,
    blankScript,
    getBlockNames,
} from '@renderer/scriptEditorLogic'
import type { Step, LaunchStep } from '@shared/script'

// -- chipKey --------------------------------------------------------------------

describe('chipKey', () => {
    it('maps press/key_down/key_up to "press"', () => {
        expect(chipKey('press')).toBe('press')
        expect(chipKey('key_down')).toBe('press')
        expect(chipKey('key_up')).toBe('press')
    })
    it('maps waitPlayerState and waitActiveApp to "wait"', () => {
        expect(chipKey('waitPlayerState')).toBe('wait')
        expect(chipKey('waitActiveApp')).toBe('wait')
    })
    it('maps unknown to "error"', () => {
        expect(chipKey('unknown')).toBe('error')
    })
    it('falls back to "other" for unrecognised types', () => {
        expect(chipKey('nonexistent')).toBe('other')
    })
})

// -- chipLabel -----------------------------------------------------------------

describe('chipLabel', () => {
    it('returns PRESS for press', () => {
        expect(chipLabel('press')).toBe('PRESS')
    })
    it('returns KEY DN for key_down', () => {
        expect(chipLabel('key_down')).toBe('KEY DN')
    })
    it('returns PAUSE for delay', () => {
        expect(chipLabel('delay')).toBe('PAUSE')
    })
    it('uppercases unknown types', () => {
        expect(chipLabel('myCustomType')).toBe('MYCUSTOMTYPE')
    })
})

// -- getStepTypeAttribute --------------------------------------------------------------

describe('getStepTypeAttribute', () => {
    it('maps press types to "press"', () => {
        expect(getStepTypeAttribute('press')).toBe('press')
        expect(getStepTypeAttribute('key_down')).toBe('press')
        expect(getStepTypeAttribute('key_up')).toBe('press')
    })
    it('maps validateStreaming to "validate"', () => {
        expect(getStepTypeAttribute('validateStreaming')).toBe('validate')
    })
    it('maps unknown to "error"', () => {
        expect(getStepTypeAttribute('unknown')).toBe('error')
    })
    it('falls back to "other"', () => {
        expect(getStepTypeAttribute('channelTileOrder')).toBe('other')
    })
    it('waitActiveApp: chipKey is "wait" but attribute is "other" (intentional divergence)', () => {
        expect(chipKey('waitActiveApp')).toBe('wait')
        expect(getStepTypeAttribute('waitActiveApp')).toBe('other')
    })
})

// -- stepLabel -----------------------------------------------------------------

describe('stepLabel', () => {
    it('returns "1" for path [0]', () => {
        expect(stepLabel([0])).toBe('1')
    })
    it('returns "2.3" for path [1, 2]', () => {
        expect(stepLabel([1, 2])).toBe('2.3')
    })
    it('handles empty path', () => {
        expect(stepLabel([])).toBe('')
    })
})

// -- escapeHtml -----------------------------------------------------------------------

describe('escapeHtml', () => {
    it('escapes ampersands, less-than, greater-than, and double-quotes', () => {
        expect(escapeHtml('<script>&"</script>')).toBe('&lt;script&gt;&amp;&quot;&lt;/script&gt;')
    })
    it('converts null/undefined to empty string via escapeHtml', () => {
        expect(escapeHtml(null)).toBe('')
        expect(escapeHtml(undefined)).toBe('')
    })
    it('converts numbers to strings', () => {
        expect(escapeHtml(42)).toBe('42')
    })
})

// -- resolveLaunchChannel ------------------------------------------------------

describe('resolveLaunchChannel', () => {
    it('prefers step-level channelName and channelId', () => {
        const step: LaunchStep = { type: 'launch', channelName: 'ESPN', channelId: '34399' }
        expect(resolveLaunchChannel(step)).toEqual({ name: 'ESPN', id: '34399' })
    })
    it('falls back to metadata channels map when step has no values', () => {
        const step: LaunchStep = { type: 'launch' }
        const metadata = { channels: { CBS: 123 } }
        expect(resolveLaunchChannel(step, metadata)).toEqual({ name: 'CBS', id: '123' })
    })
    it('ignores metadata when step has its own values', () => {
        const step: LaunchStep = { type: 'launch', channelId: '999' }
        const metadata = { channels: { CBS: 123 } }
        expect(resolveLaunchChannel(step, metadata)).toEqual({ name: '', id: '999' })
    })
    it('ignores metadata channels when it is an array', () => {
        const step: LaunchStep = { type: 'launch' }
        const metadata = { channels: ['CBS', 'ESPN'] as string[] }
        expect(resolveLaunchChannel(step, metadata)).toEqual({ name: '', id: '' })
    })
    it('ignores metadata channels map with more than one entry', () => {
        const step: LaunchStep = { type: 'launch' }
        const metadata = { channels: { CBS: 1, ESPN: 2 } }
        expect(resolveLaunchChannel(step, metadata)).toEqual({ name: '', id: '' })
    })
})

// -- stepSummaryHtml -----------------------------------------------------------

describe('stepSummaryHtml', () => {
    it('formats press steps', () => {
        const step: Step = { type: 'press', key: 'Home' }
        expect(stepSummaryHtml(step)).toBe('key: <span class="v">Home</span>')
    })
    it('formats delay steps', () => {
        const step: Step = { type: 'delay', durationMs: 2000 }
        expect(stepSummaryHtml(step)).toBe('<span class="vn">2</span>s')
    })
    it('rounds delay up to nearest second', () => {
        const step: Step = { type: 'delay', durationMs: 1100 }
        expect(stepSummaryHtml(step)).toBe('<span class="vn">2</span>s')
    })
    it('formats text steps', () => {
        const step: Step = { type: 'text', value: 'hello' }
        expect(stepSummaryHtml(step)).toBe('input: <span class="vs">"hello"</span>')
    })
    it('returns empty string for comment', () => {
        const step: Step = { type: 'comment', text: 'a comment' }
        expect(stepSummaryHtml(step)).toBe('')
    })
    it('HTML-escapes values', () => {
        const step: Step = { type: 'press', key: '<esc>' }
        expect(stepSummaryHtml(step)).toContain('&lt;esc&gt;')
    })
})

// -- looksLikeRasp -------------------------------------------------------------

describe('looksLikeRasp', () => {
    it('returns true for RASP YAML with steps: key', () => {
        expect(looksLikeRasp('steps:\n  - type: press')).toBe(true)
    })
    it('returns false for JSON', () => {
        expect(looksLikeRasp('{"version":1}')).toBe(false)
    })
    it('returns false for empty string', () => {
        expect(looksLikeRasp('')).toBe(false)
    })
    it('handles leading whitespace before steps:', () => {
        expect(looksLikeRasp('  steps:\n  - press')).toBe(true)
    })
})

// -- migrateSteps --------------------------------------------------------------

describe('migrateSteps', () => {
    it('converts unknown screenshot JSON to screenshot step', () => {
        const steps: Step[] = [{ type: 'unknown', raw: '{"screenshot":"marker1"}' }]
        migrateSteps(steps)
        expect(steps[0]).toEqual({ type: 'screenshot', marker: 'marker1' })
    })
    it('leaves non-screenshot unknown steps alone', () => {
        const steps: Step[] = [{ type: 'unknown', raw: '{"command":"foo"}' }]
        migrateSteps(steps)
        expect(steps[0].type).toBe('unknown')
    })
    it('leaves non-JSON unknown raw alone', () => {
        const steps: Step[] = [{ type: 'unknown', raw: 'not json' }]
        migrateSteps(steps)
        expect(steps[0].type).toBe('unknown')
    })
    it('recurses into loop steps', () => {
        const steps: Step[] = [{
            type: 'loop',
            iterations: 1,
            steps: [{ type: 'unknown', raw: '{"screenshot":"nested"}' }]
        }]
        migrateSteps(steps)
        const loop = steps[0]
        expect(loop.type).toBe('loop')
        if (loop.type === 'loop') {
            expect(loop.steps[0]).toEqual({ type: 'screenshot', marker: 'nested' })
        }
    })
})

// -- comparePathsDescending ----------------------------------------------------

describe('comparePathsDescending', () => {
    it('orders [2] before [1] in descending sort', () => {
        const paths = [[1], [3], [2]]
        paths.sort(comparePathsDescending)
        expect(paths).toEqual([[3], [2], [1]])
    })
    it('handles nested paths', () => {
        const paths = [[0, 1], [0, 0]]
        paths.sort(comparePathsDescending)
        expect(paths).toEqual([[0, 1], [0, 0]])
    })
})

// -- comparePathsAscending -----------------------------------------------------

describe('comparePathsAscending', () => {
    it('orders [1] before [2] in ascending sort', () => {
        const paths = [[3], [1], [2]]
        paths.sort(comparePathsAscending)
        expect(paths).toEqual([[1], [2], [3]])
    })
})

// -- blankScript ---------------------------------------------------------------

describe('blankScript', () => {
    it('returns a fresh script each call', () => {
        const first = blankScript()
        const second = blankScript()
        first.name = 'modified'
        expect(second.name).toBe('(untitled)')
    })
    it('has version 1', () => {
        expect(blankScript().version).toBe(1)
    })
    it('has empty steps', () => {
        expect(blankScript().steps).toHaveLength(0)
    })
})

// -- getBlockNames -------------------------------------------------------------

describe('getBlockNames', () => {
    it('returns an empty array when there are no blocks', () => {
        const steps: Step[] = [{ type: 'press', key: 'Home' }, { type: 'delay', durationMs: 1000 }]
        expect(getBlockNames(steps)).toEqual([])
    })
    it('collects top-level block names', () => {
        const steps = [
            { type: 'block', name: 'Login', steps: [] },
            { type: 'press', key: 'Home' },
            { type: 'block', name: 'Logout', steps: [] },
        ] as unknown as Step[]
        expect(getBlockNames(steps)).toEqual(['Login', 'Logout'])
    })
    it('recurses into loops and nested blocks', () => {
        const steps = [
            { type: 'loop', iterations: 2, steps: [
                { type: 'block', name: 'Inner', steps: [
                    { type: 'block', name: 'Deepest', steps: [] },
                ] },
            ] },
            { type: 'block', name: 'Outer', steps: [] },
        ] as unknown as Step[]
        expect(getBlockNames(steps)).toEqual(['Inner', 'Deepest', 'Outer'])
    })
})
