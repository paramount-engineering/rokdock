/**
 * Hook for managing the Roku device capture stream (video/audio via getUserMedia).
 *
 * Handles the full capture lifecycle: device enumeration, stream acquisition with
 * audio device auto-matching, idle timeout (auto-pause after inactivity), mute/volume
 * sync, and clean teardown on unmount.
 *
 * Auto-matching audio: when a video capture device is selected, this hook attempts to
 * find the audio input device from the same capture card by matching label keywords.
 * This avoids the user having to manually configure audio separately.
 *
 * Idle timeout: if enabled (idleTimeoutSec > 0), the stream is paused after the
 * specified seconds of no mouse/keyboard activity to release the OS wake lock and
 * save resources. The stream resumes on the next user interaction.
 *
 * Used by the CapturePreview, CaptureFloat, and the capture popout window renderer.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { useAppStore } from '../store/appStore'
import { enumerateVideoInputs, applyCaptureDeviceReconcile } from '../utils/mediaDevices'
import { findMatchingAudioDevice, planCaptureDeviceReconcile } from '@shared/captureDeviceMatch'

export interface CaptureDevice {
    deviceId: string
    label: string
}


export function useCaptureStream(active: boolean) {
    const videoRef = useRef<HTMLVideoElement>(null)
    const streamRef = useRef<MediaStream | null>(null)
    const captureDeviceId = useAppStore(state => state.captureDeviceId)
    const captureDeviceLabel = useAppStore(state => state.captureDeviceLabel)
    const setCaptureDeviceId = useAppStore(state => state.setCaptureDeviceId)
    const setCaptureDevice = useAppStore(state => state.setCaptureDevice)
    const captureMuted = useAppStore(state => state.captureMuted)
    const captureVolume = useAppStore(state => state.captureVolume)
    const captureIdleTimeoutSec = useAppStore(state => state.captureIdleTimeoutSec)
    const setCaptureAvailable = useAppStore(state => state.setCaptureAvailable)
    const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const lastMouseActivityRef = useRef(0)
    const [devices, setDevices] = useState<CaptureDevice[]>([])
    const [aspectRatio, setAspectRatio] = useState(16 / 9)
    const [streamActive, setStreamActive] = useState(false)
    const [idlePaused, setIdlePaused] = useState(false)
    const [error, setError] = useState<string | null>(null)

    /** Enumerate all available video input devices and update the devices list and availability flag. */
    const enumerateDevices = useCallback(async () => {
        try {
            const videoInputs = await enumerateVideoInputs()
            setDevices(videoInputs)
            setCaptureAvailable(videoInputs.length > 0)
            // Re-resolve the remembered device. Chromium re-salts deviceIds per session,
            // so the stored id may be stale even though the same physical device is present;
            // planCaptureDeviceReconcile matches by the stable label and decides whether to
            // refresh the id, backfill a missing label, or clear a genuinely absent device.
            applyCaptureDeviceReconcile(
                planCaptureDeviceReconcile(videoInputs, captureDeviceId, captureDeviceLabel),
                setCaptureDevice,
                setCaptureDeviceId
            )
        } catch {
            setDevices([])
            setCaptureAvailable(false)
        }
    }, [captureDeviceId, captureDeviceLabel, setCaptureAvailable, setCaptureDeviceId, setCaptureDevice])

    // Keep a ref to the latest enumerateDevices so the devicechange listener can be
    // registered once (on mount) yet always call the current logic. enumerateDevices is
    // recreated whenever captureDeviceId changes; binding the listener to it directly would
    // re-subscribe on every device selection, while pinning the effect to mount-only without
    // the ref would capture a stale enumerateDevices (and a stale captureDeviceId).
    const enumerateDevicesRef = useRef(enumerateDevices)
    useEffect(() => {
        enumerateDevicesRef.current = enumerateDevices
    }, [enumerateDevices])

    // Enumerate on mount and on device hotplug. The listener is registered once; the ref
    // indirection keeps the handler current without re-subscribing.
    useEffect(() => {
        const onDeviceChange = () => { enumerateDevicesRef.current() }
        onDeviceChange()
        navigator.mediaDevices.addEventListener('devicechange', onDeviceChange)
        return () => navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange)
    }, [])

    // Only stream a device that is actually present in the current enumeration.
    // On launch the persisted captureDeviceId may be a stale (re-salted) id; the
    // enumerate effect resolves it, but until then we must not call getUserMedia
    // with an unconfirmed id (it would throw and flash an error before recovering).
    // This is a primitive that stays stable while the device remains present, so
    // the stream effect does not restart on every re-enumeration.
    const streamDeviceId = captureDeviceId && devices.some(device => device.deviceId === captureDeviceId)
        ? captureDeviceId
        : null

    // Acquire or release stream based on active flag and device selection
    useEffect(() => {
        if (!active || !streamDeviceId || idlePaused) {
            // Stop existing stream
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop())
                streamRef.current = null
            }
            setStreamActive(false)
            setError(null)
            return
        }

        let cancelled = false
        const videoEl = videoRef.current

        const startStream = async () => {
            // Stop existing stream before acquiring new one
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop())
                streamRef.current = null
            }

            try {
                const allDevices = await navigator.mediaDevices.enumerateDevices()
                const audioDeviceId = findMatchingAudioDevice(streamDeviceId, allDevices)

                const constraints: MediaStreamConstraints = {
                    video: {
                        deviceId: { exact: streamDeviceId },
                        width: { ideal: 1920 },
                        height: { ideal: 1080 },
                    },
                    audio: audioDeviceId
                        ? { deviceId: { exact: audioDeviceId }, noiseSuppression: false, echoCancellation: false }
                        : false
                }

                const stream = await navigator.mediaDevices.getUserMedia(constraints)

                if (cancelled) {
                    stream.getTracks().forEach(track => track.stop())
                    return
                }

                streamRef.current = stream

                if (videoRef.current) {
                    videoRef.current.srcObject = stream

                    // Wait for video metadata to get the actual resolution
                    videoRef.current.onloadedmetadata = () => {
                        if (videoRef.current && videoRef.current.videoWidth && videoRef.current.videoHeight) {
                            setAspectRatio(videoRef.current.videoWidth / videoRef.current.videoHeight)
                        }
                        if (videoRef.current) videoRef.current.onloadedmetadata = null
                    }
                }

                setStreamActive(true)
                setError(null)
            } catch (err) {
                if (!cancelled) {
                    setStreamActive(false)
                    setError(err instanceof Error ? err.message : 'Failed to start capture')
                }
            }
        }

        startStream()

        return () => {
            cancelled = true
            if (videoEl) videoEl.onloadedmetadata = null
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop())
                streamRef.current = null
            }
            setStreamActive(false)
        }
    }, [active, streamDeviceId, idlePaused])

    // Sync mute and volume to video element
    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.muted = captureMuted
            videoRef.current.volume = captureMuted ? 0 : captureVolume / 100
        }
    }, [captureMuted, captureVolume])

    // Idle timeout - pause stream after inactivity, resume on any user interaction
    useEffect(() => {
        if ((!streamActive && !idlePaused) || captureIdleTimeoutSec <= 0) return

        const scheduleIdle = () => {
            if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
            idleTimerRef.current = setTimeout(() => {
                if (streamRef.current) {
                    streamRef.current.getTracks().forEach(track => track.stop())
                    streamRef.current = null
                }
                if (videoRef.current) videoRef.current.srcObject = null
                setStreamActive(false)
                setIdlePaused(true)
            }, captureIdleTimeoutSec * 1000)
        }

        const onActivity = () => {
            if (idlePaused) {
                setIdlePaused(false)
            }
            scheduleIdle()
        }

        const onMouseActivity = () => {
            if (!document.hasFocus()) return
            const now = Date.now()
            if (now - lastMouseActivityRef.current < 1000) return
            lastMouseActivityRef.current = now
            onActivity()
        }

        scheduleIdle()
        window.addEventListener('mousemove', onMouseActivity)
        window.addEventListener('mousedown', onMouseActivity)
        window.addEventListener('keydown', onActivity)
        window.addEventListener('focus', onActivity)

        return () => {
            if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
            window.removeEventListener('mousemove', onMouseActivity)
            window.removeEventListener('mousedown', onMouseActivity)
            window.removeEventListener('keydown', onActivity)
            window.removeEventListener('focus', onActivity)
        }
    }, [streamActive, captureIdleTimeoutSec, idlePaused])

    /**
     * Imperatively stop all tracks on the current stream and clear the video element.
     * Called before handing off to the capture popout window to avoid duplicate stream ownership.
     */
    const stopStream = useCallback(() => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop())
            streamRef.current = null
        }
        if (videoRef.current) {
            videoRef.current.srcObject = null
        }
        setStreamActive(false)
    }, [])

    return {
        videoRef,
        devices,
        aspectRatio,
        streamActive,
        idlePaused,
        error,
        stopStream
    }
}
