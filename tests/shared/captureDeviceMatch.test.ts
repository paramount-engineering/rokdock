import { describe, it, expect } from 'vitest'
import { findMatchingAudioDevice, resolveCaptureDeviceId, planCaptureDeviceReconcile } from '@shared/captureDeviceMatch'
import type { MediaDeviceLike } from '@shared/captureDeviceMatch'

// Helpers for constructing minimal device stubs.
function videoDevice(overrides: Partial<MediaDeviceLike> = {}): MediaDeviceLike {
    return {
        kind: 'videoinput',
        deviceId: 'video-1',
        groupId: 'group-1',
        label: 'Capture Card HD',
        ...overrides
    }
}

function audioDevice(overrides: Partial<MediaDeviceLike> = {}): MediaDeviceLike {
    return {
        kind: 'audioinput',
        deviceId: 'audio-1',
        groupId: 'group-1',
        label: 'Capture Card HD Audio',
        ...overrides
    }
}

// groupId matching

describe('findMatchingAudioDevice - groupId match', () => {
    it('returns the audio device with the same groupId', () => {
        const devices: MediaDeviceLike[] = [
            videoDevice({ deviceId: 'vid', groupId: 'g1' }),
            audioDevice({ deviceId: 'aud', groupId: 'g1' })
        ]
        expect(findMatchingAudioDevice('vid', devices)).toBe('aud')
    })

    it('prefers groupId match over label match', () => {
        const devices: MediaDeviceLike[] = [
            videoDevice({ deviceId: 'vid', groupId: 'g1', label: 'Elgato 4K' }),
            audioDevice({ deviceId: 'aud-group', groupId: 'g1', label: 'Unrelated Audio' }),
            audioDevice({ deviceId: 'aud-label', groupId: 'g2', label: 'Elgato 4K Audio' })
        ]
        expect(findMatchingAudioDevice('vid', devices)).toBe('aud-group')
    })
})

// label-fallback matching

describe('findMatchingAudioDevice - label fallback', () => {
    it('returns the best-scoring audio device by label when groupIds differ', () => {
        const devices: MediaDeviceLike[] = [
            videoDevice({ deviceId: 'vid', groupId: 'g1', label: 'AVerMedia Live Gamer' }),
            audioDevice({ deviceId: 'aud-weak', groupId: 'g2', label: 'Generic Audio Device' }),
            audioDevice({ deviceId: 'aud-strong', groupId: 'g3', label: 'AVerMedia Live Gamer Audio' })
        ]
        expect(findMatchingAudioDevice('vid', devices)).toBe('aud-strong')
    })

    it('returns null when the video label is empty and no groupId matches', () => {
        const devices: MediaDeviceLike[] = [
            videoDevice({ deviceId: 'vid', groupId: 'g1', label: '' }),
            audioDevice({ deviceId: 'aud', groupId: 'g2', label: 'Some Microphone' })
        ]
        expect(findMatchingAudioDevice('vid', devices)).toBeNull()
    })

    it('returns null when no audio label shares any meaningful words', () => {
        const devices: MediaDeviceLike[] = [
            videoDevice({ deviceId: 'vid', groupId: 'g1', label: 'CaptureCard Pro' }),
            audioDevice({ deviceId: 'aud', groupId: 'g2', label: 'Built-in Microphone' })
        ]
        // "microphone" and "built-in" are in the skip list, so score stays 0.
        expect(findMatchingAudioDevice('vid', devices)).toBeNull()
    })
})

// no-match cases

describe('findMatchingAudioDevice - no match', () => {
    it('returns null when videoDeviceId is not present in the list', () => {
        const devices: MediaDeviceLike[] = [
            videoDevice({ deviceId: 'other-vid' }),
            audioDevice()
        ]
        expect(findMatchingAudioDevice('vid', devices)).toBeNull()
    })

    it('returns null when there are no audio input devices', () => {
        const devices: MediaDeviceLike[] = [
            videoDevice({ deviceId: 'vid' })
        ]
        expect(findMatchingAudioDevice('vid', devices)).toBeNull()
    })

    it('returns null when all audio devices have empty labels and groupId does not match', () => {
        const devices: MediaDeviceLike[] = [
            videoDevice({ deviceId: 'vid', groupId: 'g1', label: 'Capture Card' }),
            audioDevice({ deviceId: 'aud', groupId: 'g2', label: '' })
        ]
        expect(findMatchingAudioDevice('vid', devices)).toBeNull()
    })
})

// resolveCaptureDeviceId

describe('resolveCaptureDeviceId', () => {
    const devices = [
        { deviceId: 'session-A', label: 'Game Capture HD60' },
        { deviceId: 'session-B', label: 'FaceTime HD Camera' },
    ]

    it('returns the stored id when it is still present', () => {
        expect(resolveCaptureDeviceId(devices, 'session-A', 'Game Capture HD60')).toBe('session-A')
    })

    it('re-resolves by label when the stored id is stale (re-salted)', () => {
        // Same physical device, new session id; the label still matches.
        expect(resolveCaptureDeviceId(devices, 'old-stale-id', 'Game Capture HD60')).toBe('session-A')
    })

    it('prefers the exact id match over the label match', () => {
        // Stored id points at session-B but the label says HD60; id match wins.
        expect(resolveCaptureDeviceId(devices, 'session-B', 'Game Capture HD60')).toBe('session-B')
    })

    it('returns null when neither the id nor the label is present', () => {
        expect(resolveCaptureDeviceId(devices, 'old-stale-id', 'Unplugged Card')).toBeNull()
    })

    it('returns null when there is no stored label and the id is stale', () => {
        expect(resolveCaptureDeviceId(devices, 'old-stale-id', null)).toBeNull()
    })

    it('resolves by label when the stored id is null but the label is remembered', () => {
        expect(resolveCaptureDeviceId(devices, null, 'FaceTime HD Camera')).toBe('session-B')
    })

    it('returns null for an empty device list', () => {
        expect(resolveCaptureDeviceId([], 'session-A', 'Game Capture HD60')).toBeNull()
    })
})

// planCaptureDeviceReconcile

describe('planCaptureDeviceReconcile', () => {
    const devices = [
        { deviceId: 'session-A', label: 'Game Capture HD60' },
        { deviceId: 'session-B', label: 'FaceTime HD Camera' },
    ]

    it('returns none when the list is empty (transient, keep the selection)', () => {
        expect(planCaptureDeviceReconcile([], 'old-id', 'Game Capture HD60')).toEqual({ type: 'none' })
    })

    it('returns none when the stored id is already current', () => {
        expect(planCaptureDeviceReconcile(devices, 'session-A', 'Game Capture HD60')).toEqual({ type: 'none' })
    })

    it('returns select to backfill a missing label when the id is valid', () => {
        expect(planCaptureDeviceReconcile(devices, 'session-A', null)).toEqual({
            type: 'select', deviceId: 'session-A', label: 'Game Capture HD60'
        })
    })

    it('returns refresh when the device is present under a new id (re-salt)', () => {
        expect(planCaptureDeviceReconcile(devices, 'old-stale-id', 'Game Capture HD60')).toEqual({
            type: 'refresh', deviceId: 'session-A'
        })
    })

    it('returns clear when the remembered device is absent', () => {
        expect(planCaptureDeviceReconcile(devices, 'old-stale-id', 'Unplugged Card')).toEqual({ type: 'clear' })
    })

    it('returns none when nothing is remembered and nothing resolves', () => {
        expect(planCaptureDeviceReconcile(devices, null, 'Unplugged Card')).toEqual({ type: 'none' })
    })
})
