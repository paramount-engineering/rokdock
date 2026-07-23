/**
 * Capture Preview popout entry - bundled Vite renderer.
 *
 * Streams a capture device into a frameless floating window. Handles:
 *   - Pull-model boot config via capture:get-popout-config IPC
 *   - getUserMedia stream setup with audio auto-matching
 *   - Re-resolving the capture device by its stable label, since deviceIds are salted per origin
 *   - Mute / volume sync (local slider + IPC events from the main window)
 *   - Idle-timeout auto-pause and resume on user activity
 *   - Aspect-ratio reporting so the main process can lock the window shape
 *   - Window opacity and always-on-top toggles
 *   - Save-frame via canvas.toDataURL and the capture:save-frame IPC handler
 *   - Fullscreen toggle (F11 / button / double-click) with auto-hiding toolbar
 */

import { bootBundledTheme } from '@shared/entryBootstrap'
import './appearanceModalTrigger'
import './capturePreview.css'
import {
    faVolumeHigh,
    faVolumeXmark,
    faCircleHalfStroke,
    faCamera,
    faThumbTack,
    faExpand,
    faCompress,
    faXmark,
} from '@fortawesome/free-solid-svg-icons'
import { faSvg } from '@shared/icons'
import { findMatchingAudioDevice, resolveCaptureDeviceId } from '@shared/captureDeviceMatch'
import { videoFrameToPngDataUrl } from './utils/videoFrame'

// Apply theme and await fonts before the body is revealed.
void bootBundledTheme()

// -- Icon strings --------------------------------------------------------------

const svgVolumeHigh = faSvg(faVolumeHigh)
const svgVolumeXmark = faSvg(faVolumeXmark)
const svgOpacity = faSvg(faCircleHalfStroke)
const svgCamera = faSvg(faCamera)
const svgPin = faSvg(faThumbTack)
const svgExpand = faSvg(faExpand)
const svgCompress = faSvg(faCompress)
const svgClose = faSvg(faXmark)

// -- DOM references ------------------------------------------------------------

const videoEl = document.getElementById('video') as HTMLVideoElement
const videoWrap = document.querySelector('.video-wrap') as HTMLDivElement
const placeholderEl = document.getElementById('placeholder') as HTMLDivElement

const volumeButton = document.getElementById('volumeButton') as HTMLButtonElement
const volumeFlyout = document.getElementById('volumeFlyout') as HTMLDivElement
const volumeLabel = document.getElementById('volumeLabel') as HTMLSpanElement
const volumeTrack = document.getElementById('volumeTrack') as HTMLDivElement
const volumeFill = document.getElementById('volumeFill') as HTMLDivElement
const volumeThumb = document.getElementById('volumeThumb') as HTMLDivElement
const muteBtn = document.getElementById('muteBtn') as HTMLButtonElement

const opacityBtn = document.getElementById('opacityBtn') as HTMLButtonElement
const opacityFlyout = document.getElementById('opacityFlyout') as HTMLDivElement
const opacityLabel = document.getElementById('opacityLabel') as HTMLSpanElement
const opacityTrack = document.getElementById('opacityTrack') as HTMLDivElement
const opacityFill = document.getElementById('opacityFill') as HTMLDivElement
const opacityThumb = document.getElementById('opacityThumb') as HTMLDivElement

const screenshotBtn = document.getElementById('screenshotBtn') as HTMLButtonElement
const pinBtn = document.getElementById('pinBtn') as HTMLButtonElement
const fullscreenBtn = document.getElementById('fullscreenBtn') as HTMLButtonElement
const closeBtn = document.getElementById('closeBtn') as HTMLButtonElement

// -- Inject icon SVGs ----------------------------------------------------------

volumeButton.innerHTML = svgVolumeHigh
muteBtn.innerHTML = svgVolumeHigh
opacityBtn.innerHTML = svgOpacity
screenshotBtn.innerHTML = svgCamera
pinBtn.innerHTML = svgPin
fullscreenBtn.innerHTML = svgExpand
closeBtn.innerHTML = svgClose

// -- State ---------------------------------------------------------------------

let requestedDeviceId = ''
let requestedDeviceLabel: string | null = null
let muted = true
let idleTimeoutSec = 3600
let volume = 80
let pinned = false
let volumeFlyoutOpen = false
let volumeDragging = false
let opacityOpen = false
let opacityDragging = false
let opacityValue = 100
let isFullscreen = false
let lastKnownRatio = 16 / 9
let fullscreenToolbarTimer: ReturnType<typeof setTimeout> | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
let isIdlePaused = false
let resizeScheduled = false

// -- Video sizing --------------------------------------------------------------

// Size video to fill its container using explicit pixels.
// Avoids a Chromium compositor bug with percentage/viewport units on video elements.
function sizeVideoToContainer(): void {
    if (isFullscreen) return
    const width = videoWrap.clientWidth
    const height = videoWrap.clientHeight
    videoEl.style.width = `${width}px`
    videoEl.style.height = `${height}px`
}

requestAnimationFrame(sizeVideoToContainer)
window.addEventListener('resize', () => {
    if (!resizeScheduled) {
        resizeScheduled = true
        requestAnimationFrame(() => {
            resizeScheduled = false
            sizeVideoToContainer()
        })
    }
})

// -- Volume UI -----------------------------------------------------------------

function updateVolumeUI(): void {
    const displayValue = muted ? 0 : volume
    volumeLabel.textContent = String(displayValue)
    volumeFill.style.height = `${displayValue}%`
    volumeThumb.style.bottom = `calc(${displayValue}% - 6px)`
}

function applyVolume(): void {
    videoEl.volume = muted ? 0 : volume / 100
}

function applyMute(nextMuted: boolean): void {
    muted = nextMuted
    const srcObject = videoEl.srcObject as MediaStream | null
    if (srcObject) {
        for (const track of srcObject.getAudioTracks()) {
            track.enabled = !nextMuted
        }
    }
    videoEl.volume = nextMuted ? 0 : volume / 100
    volumeButton.classList.toggle('muted', nextMuted)
    volumeButton.innerHTML = nextMuted ? svgVolumeXmark : svgVolumeHigh
    muteBtn.innerHTML = nextMuted ? svgVolumeXmark : svgVolumeHigh
    updateVolumeUI()
}

function setVolume(newVolume: number, persist: boolean): void {
    volume = Math.max(0, Math.min(100, Math.round(newVolume)))
    if (volume > 0 && muted) {
        muted = false
        applyMute(false)
        void window.rokdock.capture.syncMute(false)
    }
    if (volume === 0 && !muted) {
        muted = true
        applyMute(true)
        void window.rokdock.capture.syncMute(true)
    }
    applyVolume()
    updateVolumeUI()
    if (persist) void window.rokdock.capture.syncVolume(volume)
}

// Map a pointer Y position over a vertical track to a 0-100 value (top = 100).
// Shared by the volume and opacity flyouts.
function fractionFromY(track: HTMLElement, clientY: number): number {
    const rect = track.getBoundingClientRect()
    const fraction = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
    return Math.round(fraction * 100)
}

// -- Volume flyout events ------------------------------------------------------

volumeButton.addEventListener('click', () => {
    volumeFlyoutOpen = !volumeFlyoutOpen
    volumeFlyout.classList.toggle('open', volumeFlyoutOpen)
    if (volumeFlyoutOpen && opacityOpen) {
        opacityOpen = false
        opacityFlyout.classList.remove('open')
    }
})

document.addEventListener('mousedown', (event: MouseEvent) => {
    const target = event.target as Node
    if (volumeFlyoutOpen && !volumeFlyout.contains(target) && target !== volumeButton && !volumeButton.contains(target)) {
        volumeFlyoutOpen = false
        volumeFlyout.classList.remove('open')
    }
    if (opacityOpen && !opacityFlyout.contains(target) && target !== opacityBtn && !opacityBtn.contains(target)) {
        opacityOpen = false
        opacityFlyout.classList.remove('open')
    }
})

muteBtn.addEventListener('click', () => {
    const nextMuted = !muted
    applyMute(nextMuted)
    void window.rokdock.capture.syncMute(nextMuted)
})

volumeTrack.addEventListener('pointerdown', (event: PointerEvent) => {
    event.preventDefault()
    event.stopPropagation()
    volumeDragging = true
    volumeTrack.setPointerCapture(event.pointerId)
    setVolume(fractionFromY(volumeTrack, event.clientY), false)
})
volumeTrack.addEventListener('pointermove', (event: PointerEvent) => {
    if (!volumeDragging) return
    setVolume(fractionFromY(volumeTrack, event.clientY), false)
})
volumeTrack.addEventListener('pointerup', (event: PointerEvent) => {
    if (volumeDragging) setVolume(fractionFromY(volumeTrack, event.clientY), true)
    volumeDragging = false
})

// -- Opacity flyout ------------------------------------------------------------

function updateOpacityUI(): void {
    opacityLabel.textContent = String(opacityValue)
    opacityFill.style.height = `${opacityValue}%`
    opacityThumb.style.bottom = `calc(${opacityValue}% - 6px)`
}

function setOpacity(newOpacity: number): void {
    opacityValue = Math.max(10, Math.min(100, Math.round(newOpacity)))
    updateOpacityUI()
    void window.rokdock.capture.setPopoutOpacity(opacityValue / 100)
}

opacityBtn.addEventListener('click', () => {
    opacityOpen = !opacityOpen
    opacityFlyout.classList.toggle('open', opacityOpen)
    if (opacityOpen && volumeFlyoutOpen) {
        volumeFlyoutOpen = false
        volumeFlyout.classList.remove('open')
    }
})

opacityTrack.addEventListener('pointerdown', (event: PointerEvent) => {
    event.preventDefault()
    event.stopPropagation()
    opacityDragging = true
    opacityTrack.setPointerCapture(event.pointerId)
    setOpacity(fractionFromY(opacityTrack, event.clientY))
})
opacityTrack.addEventListener('pointermove', (event: PointerEvent) => {
    if (!opacityDragging) return
    setOpacity(fractionFromY(opacityTrack, event.clientY))
})
opacityTrack.addEventListener('pointerup', () => {
    opacityDragging = false
})

updateOpacityUI()

// -- Pin (always on top) -------------------------------------------------------

pinBtn.addEventListener('click', () => {
    pinned = !pinned
    pinBtn.classList.toggle('on', pinned)
    pinBtn.title = pinned ? 'Disable always on top' : 'Always on top'
    void window.rokdock.capture.setPopoutAlwaysOnTop(pinned)
})

// -- Screenshot (save frame) ---------------------------------------------------

screenshotBtn.addEventListener('click', () => {
    if (!videoEl.srcObject) return
    const dataUrl = videoFrameToPngDataUrl(videoEl)
    if (!dataUrl) return
    void window.rokdock.capture.saveFrame(dataUrl)
})

// Answer roBot's HDMI screenshot-fallback frame grabs with this popout's current frame (or '' if
// the stream is not live), so the fallback works while the capture is floated out of the dock.
window.rokdock.capture.onGrabFrame((requestId: string) => {
    window.rokdock.capture.frameGrabbed(requestId, videoEl.srcObject ? videoFrameToPngDataUrl(videoEl) : '')
})

// -- Close ---------------------------------------------------------------------

closeBtn.addEventListener('click', () => {
    window.close()
})

// -- Aspect ratio reporting ----------------------------------------------------

function updateAspectRatio(): void {
    const width = videoEl.videoWidth
    const height = videoEl.videoHeight
    if (width && height) {
        lastKnownRatio = width / height
        if (!isFullscreen) {
            void window.rokdock.capture.setPopoutAspectRatio(lastKnownRatio)
        }
    }
}

// -- Stream setup --------------------------------------------------------------

function showError(error: unknown): void {
    console.error('getUserMedia failed:', error)
    placeholderEl.classList.add('visible')
    videoEl.style.display = 'none'
}

function onStreamReady(stream: MediaStream): void {
    videoEl.srcObject = stream
    applyMute(muted)
    applyVolume()
    // Use the resize event: fires when the video intrinsic dimensions change,
    // which handles capture devices that negotiate resolution after initial connect.
    // Remove before re-adding so listener does not accumulate across idle-resume cycles.
    videoEl.removeEventListener('resize', updateAspectRatio)
    videoEl.addEventListener('resize', updateAspectRatio)
    // loadedmetadata fires once per stream, so { once: true } prevents accumulation.
    videoEl.addEventListener('loadedmetadata', updateAspectRatio, { once: true })
}

function tryCapture(attempts: MediaStreamConstraints[], index = 0): void {
    if (index >= attempts.length) {
        showError('All capture attempts failed')
        return
    }
    const constraints = attempts[index]
    navigator.mediaDevices.getUserMedia(constraints)
        .then(onStreamReady)
        .catch((error: unknown) => {
            const name = error instanceof Error ? error.name : ''
            const message = error instanceof Error ? error.message : String(error)
            console.warn('Attempt failed:', name, message)
            tryCapture(attempts, index + 1)
        })
}

function videoConstraintsFor(deviceId: string | null): MediaTrackConstraints {
    return {
        // exact when we have re-resolved the device in this origin, ideal only as a
        // last-resort hint (the dock's id does not resolve here, so ideal degrades
        // to the default device, which is the wrong card when several are present).
        deviceId: deviceId ? { exact: deviceId } : { ideal: requestedDeviceId },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
    }
}

function startCapture(): void {
    // Probe video-only first. This grants the media permission for this popout's
    // origin, which is what makes enumerateDevices() return device labels. deviceIds
    // are salted per origin, so the id sent from the dock does not resolve here, but
    // the stable device label does. We re-resolve the intended card by its label in this
    // origin's own enumeration, then acquire it with an exact constraint.
    const probeConstraints = videoConstraintsFor(null)
    navigator.mediaDevices.getUserMedia({ video: probeConstraints, audio: false })
        .then((videoStream: MediaStream) => {
            const probeDeviceId = videoStream.getVideoTracks()[0]?.getSettings().deviceId ?? null
            videoStream.getTracks().forEach(track => track.stop())

            return navigator.mediaDevices.enumerateDevices().then((allDevices: MediaDeviceInfo[]) => {
                const videoInputs = allDevices
                    .filter(device => device.kind === 'videoinput')
                    .map(device => ({ deviceId: device.deviceId, label: device.label }))
                // Re-resolve by the stable label. Fall back to whatever the probe
                // opened if the label is unknown (e.g. an older popout with no label).
                const resolvedVideoId = resolveCaptureDeviceId(videoInputs, requestedDeviceId, requestedDeviceLabel) ?? probeDeviceId
                const videoConstraints = videoConstraintsFor(resolvedVideoId)
                const audioDeviceId = findMatchingAudioDevice(resolvedVideoId ?? requestedDeviceId, allDevices)

                const attempts: MediaStreamConstraints[] = []
                if (audioDeviceId) {
                    attempts.push({
                        video: videoConstraints,
                        audio: {
                            deviceId: { exact: audioDeviceId },
                            noiseSuppression: false,
                            echoCancellation: false
                        }
                    })
                }
                attempts.push({ video: videoConstraints, audio: false })
                // Last resort: the soft-hint probe constraints, so a device that could not
                // be resolved by label still shows something rather than nothing. Skipped
                // when resolvedVideoId is null, because videoConstraints already equals
                // probeConstraints then and this would just duplicate the attempt above.
                if (resolvedVideoId) attempts.push({ video: probeConstraints, audio: false })
                tryCapture(attempts)
            })
        })
        .catch(showError)
}

// -- Idle timeout --------------------------------------------------------------

function scheduleIdle(): void {
    if (idleTimeoutSec <= 0 || isFullscreen) return
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
        const stream = videoEl.srcObject as MediaStream | null
        if (stream) {
            stream.getTracks().forEach(track => track.stop())
            videoEl.srcObject = null
        }
        placeholderEl.classList.add('visible')
        videoEl.style.display = 'none'
        isIdlePaused = true
    }, idleTimeoutSec * 1000)
}

function onActivity(): void {
    if (isIdlePaused) {
        isIdlePaused = false
        placeholderEl.classList.remove('visible')
        videoEl.style.display = ''
        startCapture()
    }
    scheduleIdle()
}

function onMouseActivity(): void {
    if (document.hasFocus()) onActivity()
}

// -- Fullscreen ----------------------------------------------------------------

function enterFullscreen(): void {
    document.documentElement.requestFullscreen().catch((error: unknown) => {
        console.warn('Fullscreen failed:', error)
    })
}

function exitFullscreen(): void {
    document.exitFullscreen().catch((error: unknown) => {
        console.warn('Exit fullscreen failed:', error)
    })
}

function toggleFullscreen(): void {
    if (document.fullscreenElement) {
        exitFullscreen()
    } else {
        enterFullscreen()
    }
}

function showFullscreenToolbar(): void {
    document.body.classList.add('toolbar-visible')
    if (fullscreenToolbarTimer) clearTimeout(fullscreenToolbarTimer)
    fullscreenToolbarTimer = setTimeout(() => {
        document.body.classList.remove('toolbar-visible')
    }, 2500)
}

document.addEventListener('fullscreenchange', () => {
    isFullscreen = !!document.fullscreenElement
    document.body.classList.toggle('fullscreen', isFullscreen)

    if (isFullscreen) {
        void window.rokdock.capture.setPopoutAspectRatio(0)
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
        if (volumeFlyoutOpen) { volumeFlyoutOpen = false; volumeFlyout.classList.remove('open') }
        if (opacityOpen) { opacityOpen = false; opacityFlyout.classList.remove('open') }
        showFullscreenToolbar()
    } else {
        void window.rokdock.capture.setPopoutAspectRatio(lastKnownRatio)
        scheduleIdle()
        if (fullscreenToolbarTimer) { clearTimeout(fullscreenToolbarTimer); fullscreenToolbarTimer = null }
        document.body.classList.remove('toolbar-visible')
        requestAnimationFrame(sizeVideoToContainer)
    }

    fullscreenBtn.innerHTML = isFullscreen ? svgCompress : svgExpand
    fullscreenBtn.title = isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'
})

document.addEventListener('mousemove', () => {
    if (isFullscreen) showFullscreenToolbar()
})

fullscreenBtn.addEventListener('click', toggleFullscreen)
videoWrap.addEventListener('dblclick', toggleFullscreen)

document.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'F11') {
        event.preventDefault()
        toggleFullscreen()
    }
})

// -- IPC event listeners -------------------------------------------------------

// The unsubscribe closures returned by onMuteChanged and onVolumeChanged are
// intentionally discarded. This is a single-lifetime popout window: the renderer
// process is destroyed on close, so there is no leak.
window.rokdock.capture.onMuteChanged((nextMuted: boolean) => { applyMute(nextMuted) })

window.rokdock.capture.onVolumeChanged((newVolume: number) => {
    volume = newVolume
    applyVolume()
    updateVolumeUI()
})

// -- Boot: pull config, then start stream --------------------------------------

async function init(): Promise<void> {
    const config = await window.rokdock.capture.getPopoutConfig()
    requestedDeviceId = config.deviceId
    requestedDeviceLabel = config.deviceLabel
    muted = config.muted
    idleTimeoutSec = config.idleTimeoutSec

    // Load persisted volume before applying mute so updateVolumeUI shows the right value.
    const volumeResult = await window.rokdock.capture.getVolume()
    if (volumeResult.ok && volumeResult.volume != null) {
        volume = volumeResult.volume
    }

    applyMute(muted)
    updateOpacityUI()

    startCapture()

    if (idleTimeoutSec > 0) {
        scheduleIdle()
        document.addEventListener('mousemove', onMouseActivity)
        document.addEventListener('keydown', onActivity)
        document.addEventListener('mousedown', onMouseActivity)
        window.addEventListener('focus', onActivity)
    }
}

void init()
