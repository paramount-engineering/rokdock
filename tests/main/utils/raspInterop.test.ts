import { describe, it, expect } from 'vitest'
import { importRasp, exportRasp, isRaspFile } from '@main/utils/raspInterop'
import type { ScriptFile, PressStep, DelayStep, LaunchStep, LoopStep, ScreenshotStep, WaitPlayerStateStep, ValidateStreamingStep, ChannelTileOrderStep, CommentStep, UnknownStep } from '@shared/script'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScript(steps: ScriptFile['steps']): ScriptFile {
    return { version: 1, name: 'Test', raspMode: true, steps }
}

// ---------------------------------------------------------------------------
// importRasp - basic parsing
// ---------------------------------------------------------------------------

describe('importRasp - basic parsing', () => {
    it('parses an empty steps list without error', () => {
        const yaml = `
params:
  rasp_version: 1
steps:
`
        const { script, warnings } = importRasp(yaml, 'Empty')
        expect(script.name).toBe('Empty')
        expect(script.steps).toEqual([])
        expect(script.raspMode).toBe(true)
        expect(warnings).toHaveLength(0)
    })

    it('applies the default name when none is provided', () => {
        const yaml = `
params:
  rasp_version: 1
steps:
`
        const { script } = importRasp(yaml)
        expect(script.name).toBe('Imported Script')
    })

    it('coerces a quoted rasp_version string to integer and emits a warning', () => {
        const yaml = `
params:
  rasp_version: "1"
steps:
`
        const { script, warnings } = importRasp(yaml)
        expect(script.metadata?.raspVersion).toBe(1)
        expect(warnings.some(w => w.includes('rasp_version'))).toBe(true)
    })

    it('throws on invalid YAML', () => {
        expect(() => importRasp(':: bad: yaml: [[')).toThrow(/RASP parse error/)
    })

    it('parses a YAML array document without throwing - treats it as an empty script', () => {
        // A YAML array is typeof 'object' in JS, so the guard does not throw.
        // It proceeds with an empty steps array.
        // NOTE: actual behavior - a YAML array at root level is silently treated as
        // a nearly-empty script because doc.steps is undefined (not an array).
        const { script } = importRasp('- just\n- a\n- list')
        expect(script.steps).toEqual([])
    })

    it('warns and stores requirements block in metadata', () => {
        const yaml = `
params:
  rasp_version: 1
requirements:
  os: ">=9.2"
steps:
`
        const { script, warnings } = importRasp(yaml)
        expect(script.metadata?.requirements).toBeDefined()
        expect(warnings.some(w => w.includes('requirements'))).toBe(true)
    })
})

// ---------------------------------------------------------------------------
// importRasp - step conversion
// ---------------------------------------------------------------------------

describe('importRasp - press step', () => {
    it('converts a recognized RASP key to its ECP equivalent', () => {
        const yaml = `
params:
  rasp_version: 1
steps:
  - press: home
`
        const { script, warnings } = importRasp(yaml)
        expect(script.steps).toHaveLength(1)
        const step = script.steps[0] as PressStep
        expect(step.type).toBe('press')
        // RASP 'home' maps to ECP 'Home'
        expect(step.key).toBe('Home')
        expect(warnings).toHaveLength(0)
    })

    it('converts "ok" (RASP) to "Select" (ECP)', () => {
        const yaml = `
params:
  rasp_version: 1
steps:
  - press: ok
`
        const { script } = importRasp(yaml)
        const step = script.steps[0] as PressStep
        expect(step.key).toBe('Select')
    })

    it('annotates a partner key press and adds a warning', () => {
        const yaml = `
params:
  rasp_version: 1
steps:
  - press: Netflix
`
        const { script, warnings } = importRasp(yaml)
        const step = script.steps[0] as PressStep
        expect(step.type).toBe('press')
        // Partner key stored as its RASP name since it has no ECP equivalent
        expect(step.key).toBe('Netflix')
        expect(step.annotations).toBeDefined()
        expect(step.annotations![0].level).toBe('warning')
        expect(warnings.some(w => w.includes('Netflix'))).toBe(true)
    })

    it('annotates an unrecognized key and adds a warning', () => {
        const yaml = `
params:
  rasp_version: 1
steps:
  - press: frobulate
`
        const { script, warnings } = importRasp(yaml)
        const step = script.steps[0] as PressStep
        expect(step.annotations).toBeDefined()
        expect(step.annotations![0].level).toBe('warning')
        expect(warnings.some(w => w.includes('frobulate'))).toBe(true)
    })
})

describe('importRasp - text step', () => {
    it('converts a text step', () => {
        const yaml = `
params:
  rasp_version: 1
steps:
  - text: hello world
`
        const { script } = importRasp(yaml)
        const step = script.steps[0] as { type: 'text'; value: string }
        expect(step.type).toBe('text')
        expect(step.value).toBe('hello world')
    })
})

describe('importRasp - pause/delay step', () => {
    it('converts pause seconds to durationMs', () => {
        const yaml = `
params:
  rasp_version: 1
steps:
  - pause: 3
`
        const { script } = importRasp(yaml)
        const step = script.steps[0] as DelayStep
        expect(step.type).toBe('delay')
        expect(step.durationMs).toBe(3000)
    })

    it('converts fractional seconds to durationMs using Math.round', () => {
        const yaml = `
params:
  rasp_version: 1
steps:
  - pause: 1.5
`
        const { script } = importRasp(yaml)
        const step = script.steps[0] as DelayStep
        expect(step.durationMs).toBe(1500)
    })

    it('guards against NaN pause values - returns 0 durationMs', () => {
        const yaml = `
params:
  rasp_version: 1
steps:
  - pause: "not-a-number"
`
        const { script } = importRasp(yaml)
        const step = script.steps[0] as DelayStep
        // NOTE: actual behavior - NaN or negative result is clamped to 0
        expect(step.durationMs).toBe(0)
    })

    it('guards against negative pause values - clamps to 0', () => {
        const yaml = `
params:
  rasp_version: 1
steps:
  - pause: -2
`
        const { script } = importRasp(yaml)
        const step = script.steps[0] as DelayStep
        expect(step.durationMs).toBe(0)
    })

    it('guards against Infinity pause value (.inf) - clamps to 0', () => {
        const yaml = `
params:
  rasp_version: 1
steps:
  - pause: .inf
`
        const { script } = importRasp(yaml)
        const step = script.steps[0] as DelayStep
        expect(step.durationMs).toBe(0)
    })

    it('guards against NaN pause value (.nan) - clamps to 0', () => {
        const yaml = `
params:
  rasp_version: 1
steps:
  - pause: .nan
`
        const { script } = importRasp(yaml)
        const step = script.steps[0] as DelayStep
        expect(step.durationMs).toBe(0)
    })
})

describe('importRasp - launch step', () => {
    it('converts a bare launch string step', () => {
        const yaml = `
params:
  rasp_version: 1
steps:
  - launch
`
        const { script } = importRasp(yaml)
        const step = script.steps[0] as LaunchStep
        expect(step.type).toBe('launch')
        expect(step.channelName).toBeUndefined()
        expect(step.channelId).toBeUndefined()
    })

    it('resolves channel name from the channels map', () => {
        const yaml = `
params:
  rasp_version: 1
  channels:
    Netflix: 12
steps:
  - launch: Netflix
`
        const { script } = importRasp(yaml)
        const step = script.steps[0] as LaunchStep
        expect(step.type).toBe('launch')
        expect(step.channelName).toBe('Netflix')
        expect(step.channelId).toBe(12)
    })

    it('converts an explicit channel_name/channel_id launch step', () => {
        const yaml = `
params:
  rasp_version: 1
steps:
  - launch:
    channel_name: CBS
    channel_id: 31440
`
        const { script } = importRasp(yaml)
        const step = script.steps[0] as LaunchStep
        expect(step.type).toBe('launch')
        expect(step.channelName).toBe('CBS')
        expect(step.channelId).toBe(31440)
    })
})

describe('importRasp - loop step', () => {
    it('converts a loop with nested steps', () => {
        const yaml = `
params:
  rasp_version: 1
steps:
  - loop:
      iterations: 3
      steps:
        - press: up
        - pause: 1
`
        const { script } = importRasp(yaml)
        const loop = script.steps[0] as LoopStep
        expect(loop.type).toBe('loop')
        expect(loop.iterations).toBe(3)
        expect(loop.steps).toHaveLength(2)
        expect(loop.steps[0].type).toBe('press')
        expect(loop.steps[1].type).toBe('delay')
    })
})

describe('importRasp - loop iterations validation', () => {
    function loopYaml(iterations: string): string {
        return `
params:
  rasp_version: 1
steps:
  - loop:
      iterations: ${iterations}
      steps:
        - press: up
`
    }

    it('accepts a normal positive integer', () => {
        const { script } = importRasp(loopYaml('4'))
        const loop = script.steps[0] as LoopStep
        expect(loop.iterations).toBe(4)
    })

    it('floors a fractional value to an integer', () => {
        const { script } = importRasp(loopYaml('2.7'))
        const loop = script.steps[0] as LoopStep
        expect(loop.iterations).toBe(2)
    })

    it('defaults to 1 when iterations is Infinity', () => {
        const { script } = importRasp(loopYaml('.inf'))
        const loop = script.steps[0] as LoopStep
        expect(loop.iterations).toBe(1)
    })

    it('defaults to 1 when iterations is NaN (.nan in YAML)', () => {
        const { script } = importRasp(loopYaml('.nan'))
        const loop = script.steps[0] as LoopStep
        expect(loop.iterations).toBe(1)
    })

    it('defaults to 1 when iterations is negative', () => {
        const { script } = importRasp(loopYaml('-3'))
        const loop = script.steps[0] as LoopStep
        expect(loop.iterations).toBe(1)
    })

    it('defaults to 1 when iterations is missing', () => {
        const yaml = `
params:
  rasp_version: 1
steps:
  - loop:
      steps:
        - press: up
`
        const { script } = importRasp(yaml)
        const loop = script.steps[0] as LoopStep
        expect(loop.iterations).toBe(1)
    })
})

describe('importRasp - screenshot step', () => {
    it('converts a screenshot step', () => {
        const yaml = `
params:
  rasp_version: 1
steps:
  - screenshot: after_home
`
        const { script } = importRasp(yaml)
        const step = script.steps[0] as ScreenshotStep
        expect(step.type).toBe('screenshot')
        expect(step.marker).toBe('after_home')
    })
})

describe('importRasp - waitPlayerState step', () => {
    it('converts a bare string wait_for_player_state', () => {
        const yaml = `
params:
  rasp_version: 1
steps:
  - wait_for_player_state: play
`
        const { script } = importRasp(yaml)
        const step = script.steps[0] as WaitPlayerStateStep
        expect(step.type).toBe('waitPlayerState')
        expect(step.state).toBe('play')
        expect(step.timeoutMs).toBeUndefined()
    })

    it('converts an object wait_for_player_state with timeout', () => {
        const yaml = `
params:
  rasp_version: 1
steps:
  - wait_for_player_state:
      state: pause
      timeout: 30
`
        const { script } = importRasp(yaml)
        const step = script.steps[0] as WaitPlayerStateStep
        expect(step.state).toBe('pause')
        expect(step.timeoutMs).toBe(30000)
    })

    it('normalizes unknown state strings to "stop"', () => {
        const yaml = `
params:
  rasp_version: 1
steps:
  - wait_for_player_state: unknown_state
`
        const { script } = importRasp(yaml)
        const step = script.steps[0] as WaitPlayerStateStep
        // NOTE: actual behavior - unrecognized states fall through to 'stop'
        expect(step.state).toBe('stop')
    })

    it('normalizes "buffering" state', () => {
        const yaml = `
params:
  rasp_version: 1
steps:
  - wait_for_player_state: buffering
`
        const { script } = importRasp(yaml)
        const step = script.steps[0] as WaitPlayerStateStep
        expect(step.state).toBe('buffering')
    })
})

describe('importRasp - validateStreaming step', () => {
    it('converts a bare validate_streaming string', () => {
        const yaml = `
params:
  rasp_version: 1
steps:
  - validate_streaming
`
        const { script } = importRasp(yaml)
        const step = script.steps[0] as ValidateStreamingStep
        expect(step.type).toBe('validateStreaming')
        expect(step.audioCodec).toBeUndefined()
    })

    it('converts a validate_streaming step with codec fields', () => {
        const yaml = `
params:
  rasp_version: 1
steps:
  - validate_streaming:
      audio_codec: aac
      video_codec: h264
      drm: widevine
      skip_bitrate: true
      audio_only: true
`
        const { script } = importRasp(yaml)
        const step = script.steps[0] as ValidateStreamingStep
        expect(step.type).toBe('validateStreaming')
        expect(step.audioCodec).toBe('aac')
        expect(step.videoCodec).toBe('h264')
        expect(step.drm).toBe('widevine')
        expect(step.skipBitrateValidation).toBe(true)
        expect(step.skipVideoValidation).toBe(true)
    })
})

describe('importRasp - channelTileOrder step', () => {
    it('converts a channel_tile_order step', () => {
        const yaml = `
params:
  rasp_version: 1
steps:
  - channel_tile_order:
      - Netflix
      - Hulu
      - CBS
`
        const { script } = importRasp(yaml)
        const step = script.steps[0] as ChannelTileOrderStep
        expect(step.type).toBe('channelTileOrder')
        expect(step.channels).toEqual(['Netflix', 'Hulu', 'CBS'])
    })

    it('throws when channel_tile_order is a bare string step', () => {
        const yaml = `
params:
  rasp_version: 1
steps:
  - channel_tile_order
`
        // channel_tile_order as a bare string produces an error wrapped in UnknownStep
        const { script, warnings } = importRasp(yaml)
        const step = script.steps[0] as UnknownStep
        expect(step.type).toBe('unknown')
        expect(warnings.some(w => w.includes('channel_tile_order'))).toBe(true)
    })
})

describe('importRasp - unknown step type', () => {
    it('wraps an unknown step type as UnknownStep with an error annotation', () => {
        const yaml = `
params:
  rasp_version: 1
steps:
  - frobulate: true
`
        const { script, warnings } = importRasp(yaml)
        const step = script.steps[0] as UnknownStep
        expect(step.type).toBe('unknown')
        expect(step.annotations).toBeDefined()
        expect(step.annotations![0].level).toBe('error')
        expect(warnings.some(w => w.includes('Step 1'))).toBe(true)
    })
})

describe('importRasp - CRLF and tab normalization', () => {
    it('parses a file with CRLF line endings', () => {
        const yaml = 'params:\r\n  rasp_version: 1\r\nsteps:\r\n  - press: home\r\n'
        const { script } = importRasp(yaml)
        expect(script.steps).toHaveLength(1)
        expect(script.steps[0].type).toBe('press')
    })

    it('parses a file with tab indentation', () => {
        const yaml = 'params:\n\trasp_version: 1\nsteps:\n\t- press: up\n'
        const { script } = importRasp(yaml)
        expect(script.steps).toHaveLength(1)
    })
})

// ---------------------------------------------------------------------------
// exportRasp - basic output
// ---------------------------------------------------------------------------

describe('exportRasp - basic output', () => {
    it('exports an empty script to valid YAML with steps: key', () => {
        const script = makeScript([])
        const { yaml, warnings } = exportRasp(script)
        expect(yaml).toContain('steps:')
        expect(warnings).toHaveLength(0)
    })

    it('exports a press step using the RASP key name', () => {
        const script = makeScript([{ type: 'press', key: 'Home' }])
        const { yaml } = exportRasp(script)
        // Internal key 'Home' maps back to RASP 'home'
        expect(yaml).toContain('press: home')
    })

    it('exports a text step', () => {
        const script = makeScript([{ type: 'text', value: 'search query' }])
        const { yaml } = exportRasp(script)
        expect(yaml).toContain('text: search query')
    })

    it('exports a delay - rounds up to whole seconds with 1s minimum', () => {
        const script = makeScript([{ type: 'delay', durationMs: 500 }])
        const { yaml } = exportRasp(script)
        // Sub-second delay (500ms) rounds up to 1s minimum
        expect(yaml).toContain('pause: 1')
    })

    it('exports a delay - rounds up to ceiling seconds', () => {
        const script = makeScript([{ type: 'delay', durationMs: 3100 }])
        const { yaml } = exportRasp(script)
        // 3100ms -> Math.ceil(3.1) = 4
        expect(yaml).toContain('pause: 4')
    })

    it('exports a screenshot step', () => {
        const script = makeScript([{ type: 'screenshot', marker: 'my_marker' }])
        const { yaml } = exportRasp(script)
        expect(yaml).toContain('screenshot: my_marker')
    })

    it('exports a comment step as a YAML comment line', () => {
        const script = makeScript([{ type: 'comment', text: 'This is a comment' }])
        const { yaml } = exportRasp(script)
        expect(yaml).toContain('# This is a comment')
    })

    it('omits assertQuery steps and warns', () => {
        const script = makeScript([{ type: 'assertQuery', endpoint: '/query/media-player', field: 'root.Player.Plugin.id', expected: '12345' }])
        const { yaml, warnings } = exportRasp(script)
        expect(yaml).not.toContain('assertQuery')
        expect(warnings.some(w => w.includes('assertQuery'))).toBe(true)
    })

    it('omits waitActiveApp steps and warns', () => {
        const script = makeScript([{ type: 'waitActiveApp', appId: '12345' }])
        const { yaml, warnings } = exportRasp(script)
        expect(yaml).not.toContain('waitActiveApp')
        expect(warnings.some(w => w.includes('waitActiveApp'))).toBe(true)
    })

    it('exports rasp_version as an unquoted integer', () => {
        const script = makeScript([])
        const { yaml } = exportRasp(script)
        // Ensure it is not quoted
        expect(yaml).toMatch(/rasp_version: 1/)
        expect(yaml).not.toMatch(/rasp_version: ['"]1['"]/)
    })

    it('exports a partner key press with a runtime warning', () => {
        // Partner keys round-trip: stored as RASP name, exported as RASP name
        const script = makeScript([{ type: 'press', key: 'Netflix' }])
        const { yaml, warnings } = exportRasp(script)
        expect(yaml).toContain('press: Netflix')
        expect(warnings.some(w => w.includes('partner key'))).toBe(true)
    })

    it('omits a press key that has no RASP equivalent and no partner key mapping', () => {
        const script = makeScript([{ type: 'press', key: 'UnmappableKey' }])
        const { yaml, warnings } = exportRasp(script)
        expect(yaml).not.toContain('UnmappableKey')
        expect(warnings.some(w => w.includes('UnmappableKey'))).toBe(true)
    })
})

describe('exportRasp - loop step', () => {
    it('exports a loop with nested steps', () => {
        const script = makeScript([{
            type: 'loop',
            iterations: 5,
            steps: [
                { type: 'press', key: 'Down' },
                { type: 'delay', durationMs: 2000 }
            ]
        }])
        const { yaml } = exportRasp(script)
        expect(yaml).toContain('loop:')
        expect(yaml).toContain('iterations: 5')
        expect(yaml).toContain('press: down')
        expect(yaml).toContain('pause: 2')
    })
})

describe('exportRasp - waitPlayerState', () => {
    it('exports a play state without timeout as a scalar', () => {
        const script = makeScript([{ type: 'waitPlayerState', state: 'play' }])
        const { yaml } = exportRasp(script)
        expect(yaml).toContain('wait_for_player_state: play')
    })

    it('exports a pause state with timeout as an object', () => {
        const script = makeScript([{ type: 'waitPlayerState', state: 'pause', timeoutMs: 60000 }])
        const { yaml } = exportRasp(script)
        expect(yaml).toContain('wait_for_player_state:')
        expect(yaml).toContain('state: pause')
        expect(yaml).toContain('timeout: 60')
    })

    it('maps "buffering" state to "play" on export (RASP has no buffering state)', () => {
        const script = makeScript([{ type: 'waitPlayerState', state: 'buffering' }])
        const { yaml } = exportRasp(script)
        // NOTE: actual behavior - 'buffering' and 'finished' are both mapped to 'play' on export
        expect(yaml).toContain('wait_for_player_state: play')
    })
})

describe('exportRasp - validateStreaming', () => {
    it('exports a bare validateStreaming as a scalar string', () => {
        const script = makeScript([{ type: 'validateStreaming' }])
        const { yaml } = exportRasp(script)
        expect(yaml).toContain('validate_streaming')
    })

    it('exports validateStreaming with codec fields using snake_case', () => {
        const script = makeScript([{
            type: 'validateStreaming',
            audioCodec: 'aac',
            videoCodec: 'h264',
            drm: 'widevine',
            skipBitrateValidation: true,
            skipVideoValidation: true
        }])
        const { yaml } = exportRasp(script)
        expect(yaml).toContain('audio_codec: aac')
        expect(yaml).toContain('video_codec: h264')
        expect(yaml).toContain('drm: widevine')
        expect(yaml).toContain('skip_bitrate: true')
        expect(yaml).toContain('audio_only: true')
    })
})

// ---------------------------------------------------------------------------
// Round-trip: exportRasp -> importRasp
// ---------------------------------------------------------------------------

describe('round-trip exportRasp -> importRasp', () => {
    it('round-trips a representative mix of RASP-compatible steps', () => {
        const original = makeScript([
            { type: 'press', key: 'Home' },
            { type: 'text', value: 'hello' },
            { type: 'delay', durationMs: 2000 },
            { type: 'launch', channelName: 'CBS', channelId: 31440 },
            {
                type: 'loop',
                iterations: 2,
                steps: [
                    { type: 'press', key: 'Down' },
                    { type: 'press', key: 'Select' }
                ]
            },
            { type: 'screenshot', marker: 'after_nav' },
            { type: 'waitPlayerState', state: 'play' },
            { type: 'validateStreaming', audioCodec: 'aac', videoCodec: 'h264' },
            { type: 'channelTileOrder', channels: ['Netflix', 'Hulu'] },
            { type: 'comment', text: 'done' }
        ])

        const { yaml } = exportRasp(original)
        const { script: restored, warnings } = importRasp(yaml, original.name)

        // Comments are exported as YAML comment lines and are therefore invisible
        // to the YAML parser on import - they do not survive the round-trip.
        // Delays are rounded up on export: 2000ms -> 2s -> re-imported as 2000ms.
        const nonCommentSteps = original.steps.filter(step => step.type !== 'comment')
        const restoredSteps = restored.steps

        expect(restoredSteps).toHaveLength(nonCommentSteps.length)

        const press = restoredSteps[0] as PressStep
        expect(press.type).toBe('press')
        expect(press.key).toBe('Home')

        const text = restoredSteps[1] as { type: string; value: string }
        expect(text.type).toBe('text')
        expect(text.value).toBe('hello')

        const delay = restoredSteps[2] as DelayStep
        expect(delay.type).toBe('delay')
        expect(delay.durationMs).toBe(2000)

        const launch = restoredSteps[3] as LaunchStep
        expect(launch.type).toBe('launch')
        expect(launch.channelName).toBe('CBS')
        expect(launch.channelId).toBe(31440)

        const loop = restoredSteps[4] as LoopStep
        expect(loop.type).toBe('loop')
        expect(loop.iterations).toBe(2)
        expect(loop.steps).toHaveLength(2)

        const screenshot = restoredSteps[5] as ScreenshotStep
        expect(screenshot.type).toBe('screenshot')
        expect(screenshot.marker).toBe('after_nav')

        const wps = restoredSteps[6] as WaitPlayerStateStep
        expect(wps.type).toBe('waitPlayerState')
        expect(wps.state).toBe('play')

        const vs = restoredSteps[7] as ValidateStreamingStep
        expect(vs.type).toBe('validateStreaming')
        expect(vs.audioCodec).toBe('aac')
        expect(vs.videoCodec).toBe('h264')

        const cto = restoredSteps[8] as ChannelTileOrderStep
        expect(cto.type).toBe('channelTileOrder')
        expect(cto.channels).toEqual(['Netflix', 'Hulu'])

        // No warnings expected for a clean round-trip of compatible steps
        expect(warnings).toHaveLength(0)
    })

    it('round-trip is lossy for delay: sub-second values round up to 1s minimum', () => {
        const original = makeScript([{ type: 'delay', durationMs: 300 }])
        const { yaml } = exportRasp(original)
        const { script: restored } = importRasp(yaml)
        const delay = restored.steps[0] as DelayStep
        // 300ms -> ceil(0.3)=1s on export -> 1000ms on re-import
        expect(delay.durationMs).toBe(1000)
    })

    it('round-trip is lossy for comments: they disappear after export->import', () => {
        const original = makeScript([
            { type: 'press', key: 'Home' },
            { type: 'comment', text: 'this comment will be lost' }
        ])
        const { yaml } = exportRasp(original)
        const { script: restored } = importRasp(yaml)
        // Comments are YAML comment lines; js-yaml drops them on parse
        expect(restored.steps).toHaveLength(1)
        expect(restored.steps[0].type).toBe('press')
    })

    it('RASP-incompatible steps (assertQuery) are omitted from export', () => {
        const original = makeScript([
            { type: 'press', key: 'Home' },
            { type: 'assertQuery', endpoint: '/query/media-player', field: 'x', expected: 'y' }
        ])
        const { yaml, warnings } = exportRasp(original)
        const { script: restored } = importRasp(yaml)
        expect(restored.steps).toHaveLength(1)
        expect(restored.steps[0].type).toBe('press')
        expect(warnings.some(w => w.includes('assertQuery'))).toBe(true)
    })
})

// ---------------------------------------------------------------------------
// importRasp - flat params block quirk
// ---------------------------------------------------------------------------

describe('importRasp - flat params block', () => {
    it('handles a flat params block (common in some RASP generators)', () => {
        const yaml = [
            'params:',
            'rasp_version: 1',
            'channel_name: CBS',
            'steps:',
            '  - press: home'
        ].join('\n')
        const { script } = importRasp(yaml)
        expect(script.metadata?.channelName).toBe('CBS')
        expect(script.steps).toHaveLength(1)
    })
})

// ---------------------------------------------------------------------------
// isRaspFile
// ---------------------------------------------------------------------------

describe('isRaspFile', () => {
    it('is true for RASP extensions, case-insensitive', () => {
        expect(isRaspFile('/a/b.rasp')).toBe(true)
        expect(isRaspFile('/a/b.RASP')).toBe(true)
        expect(isRaspFile('/a/b.yaml')).toBe(true)
        expect(isRaspFile('/a/b.yml')).toBe(true)
    })
    it('is false for native scripts and everything else', () => {
        expect(isRaspFile('/a/b.rscript')).toBe(false)
        expect(isRaspFile('/a/b.rscript.json')).toBe(false)
        expect(isRaspFile('/a/b.json')).toBe(false)
    })
})
