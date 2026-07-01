import type { CaptureDeviceReconcileAction } from '@shared/captureDeviceMatch'

/**
 * Apply a capture-device reconcile action (from planCaptureDeviceReconcile) to the
 * store. Kept here so both useCaptureStream and the Settings capture tab share one
 * mapping from action to setter rather than each repeating the switch.
 *
 * @param action - The planned reconcile action.
 * @param setCaptureDevice - Store action that persists both the id and the stable label.
 * @param setCaptureDeviceId - Store action that refreshes only the volatile id.
 */
export function applyCaptureDeviceReconcile(
    action: CaptureDeviceReconcileAction,
    setCaptureDevice: (id: string | null, label: string | null) => void,
    setCaptureDeviceId: (id: string | null) => void
): void {
    switch (action.type) {
        case 'select':
            setCaptureDevice(action.deviceId, action.label)
            break
        case 'refresh':
            setCaptureDeviceId(action.deviceId)
            break
        case 'clear':
            setCaptureDeviceId(null)
            break
        case 'none':
            break
    }
}

/**
 * Enumerates video input devices, triggering a getUserMedia permission grant
 * if the initial enumeration returns no devices (first-run scenario where
 * the browser hasn't granted camera access yet).
 */
export async function enumerateVideoInputs(): Promise<{ deviceId: string; label: string }[]> {
    let allDevices = await navigator.mediaDevices.enumerateDevices()
    let videoInputs = allDevices
        .filter(device => device.kind === 'videoinput')
        .map(device => ({ deviceId: device.deviceId, label: device.label || `Camera ${device.deviceId.slice(0, 8)}` }))

    if (videoInputs.length === 0) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true })
            stream.getTracks().forEach(track => track.stop())
            allDevices = await navigator.mediaDevices.enumerateDevices()
            videoInputs = allDevices
                .filter(device => device.kind === 'videoinput')
                .map(device => ({ deviceId: device.deviceId, label: device.label || `Camera ${device.deviceId.slice(0, 8)}` }))
        } catch {
            // Permission denied or genuinely no devices
        }
    }

    return videoInputs
}
