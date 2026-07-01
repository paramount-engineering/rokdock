/**
 * Integration tests for ScriptEngine end-to-end execution.
 *
 * These tests drive the REAL ScriptEngine against the REAL EcpService over a
 * real in-process HTTP server (fakeEcpServer). No stubbing of ScriptEngine or
 * EcpService -- every step executes the actual request-building and dispatch
 * code paths over real TCP loopback.
 *
 * Electron's `app` module is mocked so that `persistLog` (which calls
 * `app.getPath('userData')`) can run without a real Electron process. The fs
 * mock swallows all log writes so the tests leave no files on disk.
 *
 * Step types exercised:
 *   press, key_down, key_up, text, delay, launch, loop, block (inline),
 *   block-ref, comment (no-op), screenshot (no-op), waitPlayerState,
 *   waitActiveApp, validateStreaming, assertQuery, on_error handler.
 *
 * Step types NOT exercised (require a real device or digest-auth sideload server):
 *   channelTileOrder (requires /query/apps XML with real channel names to match),
 *   screenshot (no-op cert marker -- confirmed no-op in the switch),
 *   actual sideload / digest-auth flows.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock electron before importing ScriptEngine (which imports `app` from electron)
// ---------------------------------------------------------------------------

vi.mock('electron', () => ({
    app: {
        getPath: (_name: string) => '/tmp/fake-userdata'
    }
}))

// ---------------------------------------------------------------------------
// Mock fs so persistLog does not write files during tests
// ---------------------------------------------------------------------------

vi.mock('fs', async (importOriginal) => {
    const real = await importOriginal<typeof import('fs')>()
    return {
        ...real,
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn()
    }
})

// ---------------------------------------------------------------------------
// Imports (after mocks are registered)
// ---------------------------------------------------------------------------

import { ScriptEngine } from '@main/services/scriptEngine'
import { EcpService } from '@main/services/ecp'
import {
    createFakeEcpServer,
    FAKE_MEDIA_PLAYER_PLAYING_XML,
    FAKE_ACTIVE_APP_XML
} from './fakeEcpServer'
import type { FakeEcpServer } from './fakeEcpServer'
import type { ScriptFile, Step, EngineEvent } from '@shared/script'

const TARGET_IP = '127.0.0.1'

// ---------------------------------------------------------------------------
// Shared server and service -- one server for the file, cleared between tests
// ---------------------------------------------------------------------------

let fake: FakeEcpServer
const service = new EcpService()

beforeAll(async () => {
    fake = createFakeEcpServer()
    await fake.start()
})

afterAll(async () => {
    await fake.stop()
})

beforeEach(() => {
    fake.requests.length = 0
    fake.overrides.clear()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a minimal valid ScriptFile wrapping an array of steps. */
function makeScript(steps: Step[], name = 'test-script'): ScriptFile {
    return { version: 1, name, raspMode: false, steps }
}

/** Collects all EngineEvents emitted during play() and returns them. */
function collectEvents(): { events: EngineEvent[]; onEvent: (e: EngineEvent) => void } {
    const events: EngineEvent[] = []
    return { events, onEvent: (e) => events.push(e) }
}

/** Filters recorded requests, excluding the ping (/query/device-info) calls. */
function actionRequests(requests: FakeEcpServer['requests']) {
    return requests.filter((request) => request.path !== '/query/device-info')
}

// ---------------------------------------------------------------------------
// Basic keypress steps
// ---------------------------------------------------------------------------

describe('press step', () => {
    it('POSTs to /keypress/<key> over real TCP', async () => {
        const { events, onEvent } = collectEvents()
        const engine = new ScriptEngine(service, onEvent)
        const script = makeScript([{ type: 'press', key: 'Home' }])

        const log = await engine.play(script, TARGET_IP)

        expect(log.outcome).toBe('complete')
        const hit = actionRequests(fake.requests).find(
            (request) => request.method === 'POST' && request.path === '/keypress/Home'
        )
        expect(hit).toBeDefined()
        expect(events.some((e) => e.type === 'engine-complete')).toBe(true)
    })

    it('encodes special characters in the key name', async () => {
        const engine = new ScriptEngine(service, () => {})
        const script = makeScript([{ type: 'press', key: 'Lit_ ' }])

        await engine.play(script, TARGET_IP)

        const hit = actionRequests(fake.requests).find(
            (request) => request.method === 'POST' && request.path === '/keypress/Lit_%20'
        )
        expect(hit).toBeDefined()
    })
})

describe('key_down and key_up steps', () => {
    it('POSTs to /keydown/<key> and /keyup/<key>', async () => {
        const engine = new ScriptEngine(service, () => {})
        const script = makeScript([
            { type: 'key_down', key: 'Select' },
            { type: 'key_up', key: 'Select' }
        ])

        const log = await engine.play(script, TARGET_IP)

        expect(log.outcome).toBe('complete')
        const actions = actionRequests(fake.requests)
        expect(actions.some((request) => request.method === 'POST' && request.path === '/keydown/Select')).toBe(true)
        expect(actions.some((request) => request.method === 'POST' && request.path === '/keyup/Select')).toBe(true)
    })
})

// ---------------------------------------------------------------------------
// Text step (variable substitution)
// ---------------------------------------------------------------------------

describe('text step', () => {
    it('sends one Lit_ keypress per character', async () => {
        const engine = new ScriptEngine(service, () => {})
        const script = makeScript([{ type: 'text', value: 'Hi' }])

        await engine.play(script, TARGET_IP)

        const actions = actionRequests(fake.requests)
        expect(actions.some((request) => request.path === '/keypress/Lit_H')).toBe(true)
        expect(actions.some((request) => request.path === '/keypress/Lit_i')).toBe(true)
    })

    it('substitutes ${variable} tokens at runtime', async () => {
        const engine = new ScriptEngine(service, () => {})
        const script: ScriptFile = {
            version: 1,
            name: 'var-test',
            raspMode: false,
            metadata: { variables: { greeting: 'Hi' } },
            steps: [{ type: 'text', value: '${greeting}' }]
        }

        await engine.play(script, TARGET_IP)

        const actions = actionRequests(fake.requests)
        // 'H' and 'i' should have been sent (variable resolved to 'Hi')
        expect(actions.some((request) => request.path === '/keypress/Lit_H')).toBe(true)
        expect(actions.some((request) => request.path === '/keypress/Lit_i')).toBe(true)
        // The raw token literal characters should NOT appear
        expect(actions.some((request) => request.path.includes('Lit_%24'))).toBe(false)
    })
})

// ---------------------------------------------------------------------------
// Delay step
// ---------------------------------------------------------------------------

describe('delay step', () => {
    it('completes successfully with a 1ms delay (fast)', async () => {
        const { events, onEvent } = collectEvents()
        const engine = new ScriptEngine(service, onEvent)
        const script = makeScript([{ type: 'delay', durationMs: 1 }])

        const start = Date.now()
        const log = await engine.play(script, TARGET_IP)
        const elapsed = Date.now() - start

        expect(log.outcome).toBe('complete')
        // Delay step skips the ping, so no device-info request and no action request
        expect(fake.requests.length).toBe(0)
        // Should finish quickly (well under 1 second)
        expect(elapsed).toBeLessThan(1000)
        expect(events.some((e) => e.type === 'engine-complete')).toBe(true)
    })
})

// ---------------------------------------------------------------------------
// Launch step
// ---------------------------------------------------------------------------

describe('launch step', () => {
    it('POSTs to /launch/<channelId>', async () => {
        const engine = new ScriptEngine(service, () => {})
        const script = makeScript([{ type: 'launch', channelId: '12' }])

        const log = await engine.play(script, TARGET_IP)

        expect(log.outcome).toBe('complete')
        const hit = actionRequests(fake.requests).find(
            (request) => request.method === 'POST' && request.path === '/launch/12'
        )
        expect(hit).toBeDefined()
    })

    it('fails when channelId is absent', async () => {
        const { events, onEvent } = collectEvents()
        const engine = new ScriptEngine(service, onEvent)
        const script = makeScript([{ type: 'launch', channelName: 'Netflix' }])

        const log = await engine.play(script, TARGET_IP)

        expect(log.outcome).toBe('failed')
        expect(events.some((e) => e.type === 'engine-failed')).toBe(true)
    })
})

// ---------------------------------------------------------------------------
// Loop step -- asserts body executes exactly N times
// ---------------------------------------------------------------------------

describe('loop step', () => {
    it('executes nested steps exactly iterations times', async () => {
        const engine = new ScriptEngine(service, () => {})
        const iterations = 3
        const script = makeScript([
            {
                type: 'loop',
                iterations,
                steps: [{ type: 'press', key: 'Down' }]
            }
        ])

        const log = await engine.play(script, TARGET_IP)

        expect(log.outcome).toBe('complete')
        const keypressDown = actionRequests(fake.requests).filter(
            (request) => request.method === 'POST' && request.path === '/keypress/Down'
        )
        expect(keypressDown).toHaveLength(iterations)
    })

    it('emits step-start and step-complete for each nested step across all iterations', async () => {
        const { events, onEvent } = collectEvents()
        const engine = new ScriptEngine(service, onEvent)
        const iterations = 2
        const script = makeScript([
            {
                type: 'loop',
                iterations,
                steps: [{ type: 'press', key: 'Up' }]
            }
        ])

        await engine.play(script, TARGET_IP)

        const starts = events.filter((e) => e.type === 'step-start')
        const completes = events.filter((e) => e.type === 'step-complete')
        // 1 event for the loop step itself + 2 for the nested press (one per iteration)
        expect(starts.length).toBe(1 + iterations)
        expect(completes.length).toBe(1 + iterations)
    })
})

// ---------------------------------------------------------------------------
// Block (inline) and block-ref steps
// ---------------------------------------------------------------------------

describe('block definition step', () => {
    it('executes the inline steps of a block definition in place', async () => {
        const engine = new ScriptEngine(service, () => {})
        const script = makeScript([
            {
                type: 'block',
                name: 'navigate',
                steps: [
                    { type: 'press', key: 'Right' },
                    { type: 'press', key: 'Select' }
                ]
            }
        ])

        const log = await engine.play(script, TARGET_IP)

        expect(log.outcome).toBe('complete')
        const actions = actionRequests(fake.requests)
        expect(actions.some((request) => request.path === '/keypress/Right')).toBe(true)
        expect(actions.some((request) => request.path === '/keypress/Select')).toBe(true)
    })
})

describe('block-ref step', () => {
    it('looks up a named block and executes its steps', async () => {
        const engine = new ScriptEngine(service, () => {})
        const script = makeScript([
            {
                type: 'block',
                name: 'nav-block',
                steps: [{ type: 'press', key: 'Left' }]
            },
            { type: 'block-ref', name: 'nav-block' }
        ])

        const log = await engine.play(script, TARGET_IP)

        expect(log.outcome).toBe('complete')
        // Block runs inline (1 press) and then block-ref runs it again (1 more press)
        const presses = actionRequests(fake.requests).filter(
            (request) => request.path === '/keypress/Left'
        )
        expect(presses).toHaveLength(2)
    })

    it('fails when the referenced block name does not exist', async () => {
        const { events, onEvent } = collectEvents()
        const engine = new ScriptEngine(service, onEvent)
        const script = makeScript([{ type: 'block-ref', name: 'missing-block' }])

        const log = await engine.play(script, TARGET_IP)

        expect(log.outcome).toBe('failed')
        const failedEvent = events.find((e) => e.type === 'engine-failed') as
            | { type: 'engine-failed'; error: string }
            | undefined
        expect(failedEvent?.error).toMatch(/missing-block/)
    })
})

// ---------------------------------------------------------------------------
// No-op step types (comment, screenshot)
// ---------------------------------------------------------------------------

describe('comment and screenshot steps (no-ops)', () => {
    it('completes without sending any ECP requests', async () => {
        const engine = new ScriptEngine(service, () => {})
        const script = makeScript([
            { type: 'comment', text: 'This is a comment' },
            { type: 'screenshot', marker: 'after-launch' }
        ])

        const log = await engine.play(script, TARGET_IP)

        expect(log.outcome).toBe('complete')
        // No ping and no action requests -- both step types skip the ping gate
        expect(fake.requests.length).toBe(0)
    })
})

// ---------------------------------------------------------------------------
// Disabled steps are silently skipped
// ---------------------------------------------------------------------------

describe('disabled step', () => {
    it('does not execute a step marked disabled', async () => {
        const engine = new ScriptEngine(service, () => {})
        const script = makeScript([
            { type: 'press', key: 'Home', disabled: true },
            { type: 'press', key: 'Back' }
        ])

        await engine.play(script, TARGET_IP)

        const actions = actionRequests(fake.requests)
        expect(actions.some((request) => request.path === '/keypress/Home')).toBe(false)
        expect(actions.some((request) => request.path === '/keypress/Back')).toBe(true)
    })
})

// ---------------------------------------------------------------------------
// on_error handling
// ---------------------------------------------------------------------------

describe('on_error handling', () => {
    it('executes the on_error steps when the step fails, then continues', async () => {
        // Make the ping fail for the first press but succeed for the recovery press.
        // Override /keypress/Select to return 500 so the step itself fails.
        fake.overrides.set('POST /keypress/Select', { status: 500, body: 'Device Error' })

        const { events, onEvent } = collectEvents()
        const engine = new ScriptEngine(service, onEvent)
        const script = makeScript([
            {
                type: 'press',
                key: 'Select',
                onError: [{ type: 'press', key: 'Back' }]
            },
            { type: 'press', key: 'Home' }
        ])

        const log = await engine.play(script, TARGET_IP)

        // Script should complete (on_error consumed the failure)
        expect(log.outcome).toBe('complete')

        // The failed step should be recorded as failed in the log
        const failedEntry = log.entries.find((e) => e.type === 'press' && e.status === 'failed')
        expect(failedEntry).toBeDefined()
        expect(failedEntry?.error).toMatch(/500/)

        // The on_error recovery step (Back) should have fired
        const actions = actionRequests(fake.requests)
        expect(actions.some((request) => request.path === '/keypress/Back')).toBe(true)

        // Execution should have continued to the next step (Home)
        expect(actions.some((request) => request.path === '/keypress/Home')).toBe(true)

        // step-failed event should have been emitted
        expect(events.some((e) => e.type === 'step-failed')).toBe(true)
    })

    it('propagates the error and fails the engine when on_error is not defined', async () => {
        fake.overrides.set('POST /keypress/Select', { status: 500, body: 'Device Error' })

        const { events, onEvent } = collectEvents()
        const engine = new ScriptEngine(service, onEvent)
        const script = makeScript([{ type: 'press', key: 'Select' }])

        const log = await engine.play(script, TARGET_IP)

        expect(log.outcome).toBe('failed')
        expect(events.some((e) => e.type === 'engine-failed')).toBe(true)
    })

    it('continues after an empty on_error array (error is silently handled)', async () => {
        fake.overrides.set('POST /keypress/Select', { status: 500, body: 'Device Error' })

        const engine = new ScriptEngine(service, () => {})
        const script = makeScript([
            { type: 'press', key: 'Select', onError: [] },
            { type: 'press', key: 'Home' }
        ])

        const log = await engine.play(script, TARGET_IP)

        expect(log.outcome).toBe('complete')
        const actions = actionRequests(fake.requests)
        expect(actions.some((request) => request.path === '/keypress/Home')).toBe(true)
    })
})

// ---------------------------------------------------------------------------
// stop() -- graceful cancellation
// ---------------------------------------------------------------------------

describe('engine.stop()', () => {
    it('stops after the current step completes when stop() is called during play()', async () => {
        const events: EngineEvent[] = []

        // Build the engine first so we can reference it inside the onEvent callback.
        let engine: ScriptEngine
        const onEvent = (e: EngineEvent) => {
            events.push(e)
            // After the first step-complete, request a stop so the engine exits
            // before starting step 2.
            if (e.type === 'step-complete' && events.filter((ev) => ev.type === 'step-complete').length === 1) {
                engine.stop()
            }
        }
        engine = new ScriptEngine(service, onEvent)

        const script = makeScript([
            { type: 'press', key: 'Home' },
            { type: 'press', key: 'Back' }
        ])

        const log = await engine.play(script, TARGET_IP)

        expect(log.outcome).toBe('stopped')
        expect(events.some((e) => e.type === 'engine-stopped')).toBe(true)
        // Only the first press should have fired
        const actions = actionRequests(fake.requests)
        expect(actions.some((request) => request.path === '/keypress/Home')).toBe(true)
        expect(actions.some((request) => request.path === '/keypress/Back')).toBe(false)
    })
})

// ---------------------------------------------------------------------------
// waitPlayerState step
// ---------------------------------------------------------------------------

describe('waitPlayerState step', () => {
    it('resolves immediately when the player is already in the expected state', async () => {
        // The fake server returns FAKE_MEDIA_PLAYER_PLAYING_XML by default (state=play).
        const engine = new ScriptEngine(service, () => {})
        const script = makeScript([
            {
                type: 'waitPlayerState',
                state: 'play',
                intervalMs: 1,
                timeoutMs: 500
            }
        ])

        const log = await engine.play(script, TARGET_IP)

        expect(log.outcome).toBe('complete')
        const hit = fake.requests.find((request) => request.path === '/query/media-player')
        expect(hit).toBeDefined()
    })

    it('fails with a timeout error when the expected state is never reached', async () => {
        // Override media-player to return a stopped state.
        fake.overrides.set('GET /query/media-player', {
            status: 200,
            body: '<?xml version="1.0"?><player state="stop" error="false"/>'
        })

        const { events, onEvent } = collectEvents()
        const engine = new ScriptEngine(service, onEvent)
        const script = makeScript([
            {
                type: 'waitPlayerState',
                state: 'play',
                intervalMs: 1,
                timeoutMs: 10
            }
        ])

        const log = await engine.play(script, TARGET_IP)

        expect(log.outcome).toBe('failed')
        const failedEvent = events.find((e) => e.type === 'engine-failed') as
            | { type: 'engine-failed'; error: string }
            | undefined
        expect(failedEvent?.error).toMatch(/timeout/)
    })
})

// ---------------------------------------------------------------------------
// validateStreaming step
// ---------------------------------------------------------------------------

describe('validateStreaming step', () => {
    it('passes when the player is playing and codecs match', async () => {
        // Default fake returns state=play, audioCodec=aac, videoCodec=hevc
        const engine = new ScriptEngine(service, () => {})
        const script = makeScript([
            {
                type: 'validateStreaming',
                audioCodec: 'aac',
                videoCodec: 'hevc'
            }
        ])

        const log = await engine.play(script, TARGET_IP)

        expect(log.outcome).toBe('complete')
    })

    it('fails with a codec mismatch error', async () => {
        const { events, onEvent } = collectEvents()
        const engine = new ScriptEngine(service, onEvent)
        const script = makeScript([
            {
                type: 'validateStreaming',
                audioCodec: 'ac3'
            }
        ])

        const log = await engine.play(script, TARGET_IP)

        expect(log.outcome).toBe('failed')
        const failedEvent = events.find((e) => e.type === 'engine-failed') as
            | { type: 'engine-failed'; error: string }
            | undefined
        expect(failedEvent?.error).toMatch(/audioCodec/)
    })

    it('skips when player is not playing and onNotPlaying is "skip"', async () => {
        fake.overrides.set('GET /query/media-player', {
            status: 200,
            body: '<?xml version="1.0"?><player state="stop" error="false"/>'
        })

        const { events, onEvent } = collectEvents()
        const engine = new ScriptEngine(service, onEvent)
        const script = makeScript([
            { type: 'validateStreaming', onNotPlaying: 'skip' }
        ])

        const log = await engine.play(script, TARGET_IP)

        expect(log.outcome).toBe('complete')
        // The step itself should be recorded as skipped
        const skippedEntry = log.entries.find((e) => e.type === 'validateStreaming' && e.status === 'skipped')
        expect(skippedEntry).toBeDefined()
        expect(events.some((e) => e.type === 'step-skipped')).toBe(true)
    })
})

// ---------------------------------------------------------------------------
// waitActiveApp step
// ---------------------------------------------------------------------------

describe('waitActiveApp step', () => {
    it('resolves immediately when the active app already matches', async () => {
        // Default fake returns id="12" for /query/active-app.
        const engine = new ScriptEngine(service, () => {})
        const script = makeScript([
            {
                type: 'waitActiveApp',
                appId: '12',
                intervalMs: 1,
                timeoutMs: 500
            }
        ])

        const log = await engine.play(script, TARGET_IP)

        expect(log.outcome).toBe('complete')
    })

    it('fails with a timeout error when the app never becomes active', async () => {
        fake.overrides.set('GET /query/active-app', {
            status: 200,
            body: '<?xml version="1.0"?><active-app><app id="99">Other</app></active-app>'
        })

        const { events, onEvent } = collectEvents()
        const engine = new ScriptEngine(service, onEvent)
        const script = makeScript([
            {
                type: 'waitActiveApp',
                appId: '12',
                intervalMs: 1,
                timeoutMs: 10
            }
        ])

        const log = await engine.play(script, TARGET_IP)

        expect(log.outcome).toBe('failed')
        const failedEvent = events.find((e) => e.type === 'engine-failed') as
            | { type: 'engine-failed'; error: string }
            | undefined
        expect(failedEvent?.error).toMatch(/timeout/)
    })
})

// ---------------------------------------------------------------------------
// assertQuery step
// ---------------------------------------------------------------------------

describe('assertQuery step', () => {
    it('passes when the queried field matches the expected value', async () => {
        // /query/active-app returns an app with id="12"
        const engine = new ScriptEngine(service, () => {})
        const script = makeScript([
            {
                type: 'assertQuery',
                endpoint: '/query/active-app',
                // The XML is <active-app><app id="12">...</app></active-app>
                // fast-xml-parser with ignoreAttributes:false maps this as:
                //   parsed['active-app'].app['@_id'] === '12'
                field: 'active-app.app.@_id',
                expected: '12'
            }
        ])

        const log = await engine.play(script, TARGET_IP)

        expect(log.outcome).toBe('complete')
    })

    it('fails when the queried field does not match', async () => {
        const { events, onEvent } = collectEvents()
        const engine = new ScriptEngine(service, onEvent)
        const script = makeScript([
            {
                type: 'assertQuery',
                endpoint: '/query/active-app',
                field: 'active-app.app.@_id',
                expected: '99'
            }
        ])

        const log = await engine.play(script, TARGET_IP)

        expect(log.outcome).toBe('failed')
        expect(events.some((e) => e.type === 'engine-failed')).toBe(true)
    })
})

// ---------------------------------------------------------------------------
// Multi-step script: realistic sequence
// ---------------------------------------------------------------------------

describe('multi-step script execution', () => {
    it('executes a realistic sequence of steps and produces a complete log', async () => {
        const { events, onEvent } = collectEvents()
        const engine = new ScriptEngine(service, onEvent)
        const script = makeScript([
            { type: 'press', key: 'Home' },
            { type: 'delay', durationMs: 1 },
            { type: 'launch', channelId: '12' },
            { type: 'comment', text: 'Launched Netflix' },
            {
                type: 'loop',
                iterations: 2,
                steps: [{ type: 'press', key: 'Right' }]
            }
        ])

        const log = await engine.play(script, TARGET_IP)

        expect(log.outcome).toBe('complete')
        expect(log.scriptName).toBe('test-script')
        expect(log.completedAt).toBeGreaterThan(log.startedAt)

        const actions = actionRequests(fake.requests)
        expect(actions.some((request) => request.path === '/keypress/Home')).toBe(true)
        expect(actions.some((request) => request.path === '/launch/12')).toBe(true)
        // Loop ran twice
        expect(actions.filter((request) => request.path === '/keypress/Right')).toHaveLength(2)

        // Log entries cover all non-disabled steps (5 top-level: press, delay, launch,
        // comment, loop) + 2 nested press steps = 7 entries total.
        expect(log.entries).toHaveLength(7)
        expect(events.some((e) => e.type === 'engine-complete')).toBe(true)
    })
})

// ---------------------------------------------------------------------------
// ExecutionLog shape
// ---------------------------------------------------------------------------

describe('ExecutionLog fields', () => {
    it('records label, type, status, startedAt, and completedAt for each step', async () => {
        const engine = new ScriptEngine(service, () => {})
        const script = makeScript([{ type: 'press', key: 'Home' }])

        const log = await engine.play(script, TARGET_IP)

        expect(log.entries).toHaveLength(1)
        const entry = log.entries[0]
        expect(entry.label).toBe('1')
        expect(entry.type).toBe('press')
        expect(entry.status).toBe('complete')
        expect(typeof entry.startedAt).toBe('number')
        expect(typeof entry.completedAt).toBe('number')
        expect(entry.completedAt).toBeGreaterThanOrEqual(entry.startedAt!)
    })

    it('records nested step labels with dot-notation (e.g. 1.1 inside a loop)', async () => {
        const engine = new ScriptEngine(service, () => {})
        const script = makeScript([
            {
                type: 'loop',
                iterations: 1,
                steps: [{ type: 'press', key: 'Up' }]
            }
        ])

        const log = await engine.play(script, TARGET_IP)

        const nestedEntry = log.entries.find((e) => e.type === 'press')
        expect(nestedEntry?.label).toMatch(/^1\./)
    })
})
