/**
 * Renderer UI constants for layout dimensions and settings range constraints.
 *
 * REMOTE_IMAGE_MAX_WIDTH: maximum pixel width of the Roku remote image in
 *   the right panel. Constrains the rokdock-remote web component display size.
 *
 * REMOTE_CAPTURE_TOAST_DURATION_MS: how long the screenshot success toast
 *   remains visible in the remote panel toolbar.
 *
 * DISCOVERY_*_RANGE / DEV_APP_POLL_INTERVAL_RANGE: min/max/step bounds for
 *   the slider controls in the Settings > Discovery tab. Kept here so both
 *   the slider components and validation logic reference the same values.
 */
export const REMOTE_IMAGE_MAX_WIDTH = 154
export const REMOTE_CAPTURE_TOAST_DURATION_MS = 5600

export const DISCOVERY_SCAN_INTERVAL_RANGE = {
    min: 30000,
    max: 600000,
    step: 5000
} as const

export const DISCOVERY_REQUEST_TIMEOUT_RANGE = {
    min: 1000,
    max: 15000,
    step: 250
} as const

export const DEV_APP_POLL_INTERVAL_RANGE = {
    min: 500,
    max: 15000,
    step: 100
} as const
