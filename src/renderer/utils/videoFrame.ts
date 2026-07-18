/**
 * Draw the current frame of a playing <video> to a PNG data URL.
 *
 * Returns '' when there is no frame to capture (the video has zero dimensions, i.e. no stream or
 * metadata yet) or a 2D canvas context cannot be obtained. Callers decide how to surface that
 * (skip silently, show a toast, etc.). Shared by the capture popout, the screenshot preview's
 * capture-from-feed action, and roBot's HDMI screenshot fallback.
 */
export function videoFrameToPngDataUrl(video: HTMLVideoElement): string {
    if (!video.videoWidth || !video.videoHeight) return ''
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''
    ctx.drawImage(video, 0, 0)
    return canvas.toDataURL('image/png')
}
