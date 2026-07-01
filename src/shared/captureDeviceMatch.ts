/**
 * Pure helper for matching a capture card's audio input to its video input.
 *
 * DOM-free and side-effect-free. Safe to import from both the main process and
 * bundled renderer entries (no Node.js or browser globals are used).
 *
 * MediaDeviceInfo is a structural type so we accept a minimal subset to keep
 * this helper testable in a Node.js vitest environment without a DOM.
 */

export interface MediaDeviceLike {
    kind: string
    deviceId: string
    groupId: string
    label: string
}

/**
 * Find an audio input device that belongs to the same physical capture card as
 * the given video device. Tries groupId matching first (no permissions needed,
 * the groupId is always populated), then falls back to label keyword matching.
 *
 * Returns the matched audio deviceId, or null when no match is found.
 *
 * @param videoDeviceId - The deviceId of the active video input device.
 * @param allDevices - The full list of media devices from enumerateDevices().
 */
export function findMatchingAudioDevice(
    videoDeviceId: string,
    allDevices: MediaDeviceLike[]
): string | null {
    const videoDevice = allDevices.find(
        device => device.kind === 'videoinput' && device.deviceId === videoDeviceId
    )
    if (!videoDevice) return null

    const audioInputs = allDevices.filter(device => device.kind === 'audioinput')

    // groupId is shared between video and audio endpoints of the same physical
    // device (e.g. a capture card). No permissions are needed. It is always present.
    if (videoDevice.groupId) {
        const byGroup = audioInputs.find(device => device.groupId === videoDevice.groupId)
        if (byGroup) return byGroup.deviceId
    }

    // Fall back to label matching. Labels require that the page already holds
    // a media permission. If labels are empty the match is skipped.
    if (!videoDevice.label) return null
    const labeledAudioInputs = audioInputs.filter(device => device.label)
    if (labeledAudioInputs.length === 0) return null

    const skipWords = new Set([
        'microphone', 'built-in', 'default', 'audio', 'input', 'output', 'device'
    ])
    const regex = /[\s\-_()[\]/]+/
    const videoWords = videoDevice.label
        .split(regex)
        .map(w => w.toLowerCase())
        .filter(w => w.length >= 3 && !skipWords.has(w))

    let bestMatch: { deviceId: string; score: number } | null = null
    for (const audioDevice of labeledAudioInputs) {
        const audioLabel = audioDevice.label.toLowerCase()
        let score = 0
        for (const word of videoWords) {
            if (audioLabel.includes(word)) score++
        }
        if (score > 0 && (!bestMatch || score > bestMatch.score)) {
            bestMatch = { deviceId: audioDevice.deviceId, score }
        }
    }

    return bestMatch?.deviceId ?? null
}

/**
 * Resolve the current-session video device id for a remembered capture device.
 *
 * Chromium salts MediaDeviceInfo.deviceId per origin, and the salt is not
 * persisted across sessions for the file:// origin the dock runs from, so the
 * same physical device gets a fresh deviceId on each launch. The device label
 * (its product string) is stable, so we remember the label and re-resolve the
 * volatile id from it.
 *
 * Resolution order: an exact deviceId match (same session, or a stable salt),
 * then a label match (the device came back under a new id). Returns null when
 * neither matches, meaning the remembered device is genuinely not present.
 *
 * @param devices - The available video inputs from the current enumeration.
 * @param storedDeviceId - The deviceId persisted from a prior selection (may be stale).
 * @param storedLabel - The device label persisted from a prior selection (stable).
 */
export function resolveCaptureDeviceId(
    devices: { deviceId: string; label: string }[],
    storedDeviceId: string | null,
    storedLabel: string | null
): string | null {
    if (storedDeviceId && devices.some(device => device.deviceId === storedDeviceId)) {
        return storedDeviceId
    }
    if (storedLabel) {
        const byLabel = devices.find(device => device.label === storedLabel)
        if (byLabel) return byLabel.deviceId
    }
    return null
}

/**
 * The action a consumer should take to keep its remembered capture device in sync
 * with the current device list, after re-resolving the volatile id.
 *  - 'none':    nothing to do (already current, or the list is transiently empty).
 *  - 'select':  the id is valid but no stable label was stored yet; persist both
 *               (backfill the label for a device picked before labels were tracked).
 *  - 'refresh': the device is present under a new id (re-salt); update the id only,
 *               keeping the stored label.
 *  - 'clear':   the remembered device is genuinely absent; drop the volatile id
 *               (the caller keeps the label so it reconnects if the device returns).
 */
export type CaptureDeviceReconcileAction =
    | { type: 'none' }
    | { type: 'select'; deviceId: string; label: string }
    | { type: 'refresh'; deviceId: string }
    | { type: 'clear' }

/**
 * Decide how to reconcile a remembered capture device against the current devices.
 * Pure and DOM-free: the caller performs the resulting store write. An empty device
 * list yields 'none' (it may be a transient mid-hotplug state, not a removed device,
 * so the selection is preserved).
 *
 * @param devices - The current video inputs.
 * @param storedId - The persisted (possibly stale) deviceId.
 * @param storedLabel - The persisted stable label.
 */
export function planCaptureDeviceReconcile(
    devices: { deviceId: string; label: string }[],
    storedId: string | null,
    storedLabel: string | null
): CaptureDeviceReconcileAction {
    if (devices.length === 0) return { type: 'none' }
    const resolved = resolveCaptureDeviceId(devices, storedId, storedLabel)
    if (resolved) {
        const device = devices.find(device => device.deviceId === resolved)
        if (device && !storedLabel) return { type: 'select', deviceId: resolved, label: device.label }
        if (resolved !== storedId) return { type: 'refresh', deviceId: resolved }
        return { type: 'none' }
    }
    return storedId ? { type: 'clear' } : { type: 'none' }
}
