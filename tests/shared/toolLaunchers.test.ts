import { describe, it, expect } from 'vitest'
import { TOOL_LAUNCHERS } from '@shared/toolLaunchers'
import { TOOL_KEYS } from '@main/launch/launchRequest'

describe('tool launcher manifest', () => {
    it('every launcher has a non-empty key, title, and badge', () => {
        for (const launcher of TOOL_LAUNCHERS) {
            expect(launcher.key.length).toBeGreaterThan(0)
            expect(launcher.title.length).toBeGreaterThan(0)
            expect(launcher.badge.length).toBeGreaterThan(0)
        }
    })

    it('keys are unique', () => {
        const keys = TOOL_LAUNCHERS.map(launcher => launcher.key)
        expect(new Set(keys).size).toBe(keys.length)
    })

    it('keys exactly match the launch-accepted tool keys (no drift)', () => {
        const manifestKeys = [...TOOL_LAUNCHERS.map(launcher => launcher.key)].sort()
        const launchKeys = [...TOOL_KEYS].sort()
        expect(manifestKeys).toEqual(launchKeys)
    })
})
