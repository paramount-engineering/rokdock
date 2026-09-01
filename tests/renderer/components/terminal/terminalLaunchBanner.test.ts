import { describe, it, expect } from 'vitest'
import {
    computeAppRunBoundaries,
    buildRunBoundaryGradient
} from '@renderer/components/terminal/terminalLaunchBanner'

const RUNNING_X = "------ Running dev 'X' runuserinterface ------"
const RUNNING_X_MAIN = "------ Running dev 'X' main ------"
const RUNNING_Y = "------ Running dev 'Y' runuserinterface ------"
const COMPILING_X = "------ Compiling dev 'X' ------"
const COMPILING_Y = "------ Compiling dev 'Y' ------"

describe('computeAppRunBoundaries', () => {
    it('is all-off and has no block starts when no marker ever appears', () => {
        const lines = ['a', 'b', 'c']
        expect(computeAppRunBoundaries(lines)).toEqual({
            tint: [false, false, false],
            blockStart: [false, false, false]
        })
    })

    it('does not treat an ordinary log line, a plain dash separator, or empty text as a marker', () => {
        const lines = [
            "08-21 04:18:44.952 sdkl [scrpt.load.mkup] Loading markup 58484 'Roku Ads Library'",
            '------------------------------------------',
            ''
        ]
        expect(computeAppRunBoundaries(lines).blockStart).toEqual([false, false, false])
    })

    it('a bare Running marker (no preceding Compiling) starts a block, "main" entry point included', () => {
        const lines = ['before', RUNNING_X, 'after']
        expect(computeAppRunBoundaries(lines)).toEqual({
            tint: [false, true, true],
            blockStart: [false, true, false]
        })
        expect(computeAppRunBoundaries(['before', RUNNING_X_MAIN, 'after']).blockStart).toEqual([false, true, false])
    })

    it('does not match a Running banner missing its entry-point token', () => {
        expect(computeAppRunBoundaries(["------ Running dev 'X' ------"]).blockStart).toEqual([false])
    })

    it('a Compiling marker immediately followed by a Running marker for the SAME channel is one block: only the Compiling line starts it', () => {
        const lines = [COMPILING_X, RUNNING_X, 'output']
        expect(computeAppRunBoundaries(lines)).toEqual({
            tint: [true, true, true],
            blockStart: [true, false, false]
        })
    })

    it('two full compile+run cycles for the same channel alternate the tint per cycle', () => {
        const lines = [COMPILING_X, RUNNING_X, 'run1 output', COMPILING_X, RUNNING_X, 'run2 output']
        expect(computeAppRunBoundaries(lines)).toEqual({
            tint: [true, true, true, false, false, false],
            blockStart: [true, false, false, true, false, false]
        })
    })

    it('a Compiling marker for a DIFFERENT channel than the following Running does not merge (name must match)', () => {
        const lines = [COMPILING_X, RUNNING_Y]
        expect(computeAppRunBoundaries(lines)).toEqual({
            tint: [true, false],
            blockStart: [true, true]
        })
    })

    it('a bare rerun with no recompile still starts its own new block', () => {
        const lines = [COMPILING_X, RUNNING_X, 'run1 output', RUNNING_X, 'run2 output']
        expect(computeAppRunBoundaries(lines)).toEqual({
            tint: [true, true, true, false, false],
            blockStart: [true, false, false, true, false]
        })
    })

    it('a real sideload: two Compiling markers for the same channel before the one Running marker are all one block (observed live: the firmware recompiles a shared library between them, then re-enters the app)', () => {
        const lines = [COMPILING_X, 'sub-compile output', COMPILING_X, RUNNING_X]
        expect(computeAppRunBoundaries(lines)).toEqual({
            tint: [true, true, true, true],
            blockStart: [true, false, false, false]
        })
    })

    it('a Compiling marker following a COMPLETED Running marker for the same channel is a new block (a redeploy), but one before that Running is not', () => {
        const lines = [COMPILING_X, RUNNING_X, COMPILING_X, RUNNING_X]
        expect(computeAppRunBoundaries(lines)).toEqual({
            tint: [true, true, false, false],
            blockStart: [true, false, true, false]
        })
    })

    it('a different channel entirely always starts a new block', () => {
        const lines = [COMPILING_X, RUNNING_X, COMPILING_Y, RUNNING_Y]
        expect(computeAppRunBoundaries(lines)).toEqual({
            tint: [true, true, false, false],
            blockStart: [true, false, true, false]
        })
    })
})

describe('buildRunBoundaryGradient', () => {
    const base = {
        rowHeightPx: 18,
        dividerThicknessPx: 2,
        beforeColor: 'BEFORE',
        afterColor: 'AFTER',
        accentColor: 'ACCENT'
    }

    it('bottom-anchors the divider (non-centered): before-color fills down to the last slice, then accent to 100%', () => {
        const gradient = buildRunBoundaryGradient({ ...base, centered: false })
        expect(gradient).toBe(
            'linear-gradient(to bottom, BEFORE 0%, BEFORE 88.88888888888889%, ACCENT 88.88888888888889%, ACCENT 100%)'
        )
    })

    it('centers the divider: before-color, then accent in the middle, then after-color, so the tint change lands exactly on the line', () => {
        const gradient = buildRunBoundaryGradient({ ...base, centered: true })
        expect(gradient).toBe(
            'linear-gradient(to bottom, BEFORE 0%, BEFORE 44.44444444444444%, ACCENT 44.44444444444444%, '
            + 'ACCENT 55.55555555555556%, AFTER 55.55555555555556%, AFTER 100%)'
        )
    })

    it('the centered accent band is exactly dividerThicknessPx tall relative to rowHeightPx', () => {
        const gradient = buildRunBoundaryGradient({ ...base, centered: true })
        const [, start, end] = gradient.match(/ACCENT ([\d.]+)%, ACCENT ([\d.]+)%/)!
        expect(Number(end) - Number(start)).toBeCloseTo((2 / 18) * 100, 5)
    })
})
