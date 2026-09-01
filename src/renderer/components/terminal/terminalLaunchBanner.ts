/**
 * Detects the Roku console's launch-chain banners ("Compiling dev '<channel>'" and
 * "Running dev '<channel>' <entryPoint>") and derives, per line, which app-run "block"
 * it belongs to, so the terminal can band each block's output with a distinct
 * background tint. Consecutive app launches (or compile/run cycles for the same
 * channel) then read as visually distinct regions while scrolling a long buffer.
 *
 * A block starts at a marker for a channel that has not already run in the current
 * block; any further marker for that SAME channel, of either kind, keeps folding into
 * the same block until a Running marker for it actually appears, at which point that
 * channel is "spent" for the block and the next marker for it starts a fresh one. This
 * covers a real sideload sequence observed live: the firmware emits "Compiling dev
 * 'X'" TWICE (it recompiles a shared library in between, then re-enters the app)
 * before the one "Running dev 'X'" line - both Compiling markers and the Running
 * marker are one block, a build-then-launch cycle, not three. A bare rerun with no
 * recompile, a redeploy of a channel that already ran in an earlier block, or a
 * different channel each start a new block. Flipping on every raw marker instead (with
 * no merge rule) would make every Compiling phase and every Running phase always land
 * on the same two colors, respectively, since a simple cycle is only two markers -
 * that distinguishes phase from phase, not cycle from cycle, which is the opposite of
 * the goal here.
 *
 * The entry-point token in a Running banner varies by channel type (firmware-emitted,
 * not something RokDock controls): a SceneGraph UI channel says "runuserinterface"; a
 * task-based channel with no UI (e.g. a benchmark script) says "main". Any single
 * token there is accepted, since the banner shape itself (not the specific entry
 * point name) is the signal.
 *
 * Observed formats:
 *   ------ Compiling dev 'RoComponentBench' ------
 *   ------ Running dev 'Paramount Plus' runuserinterface ------
 *   ------ Running dev 'RoComponentBench' main ------
 */

const COMPILING_LINE_RE = /^-+ Compiling dev '([^']*)' -+$/
const RUNNING_LINE_RE = /^-+ Running dev '([^']*)' \S+ -+$/

type LaunchMarkerKind = 'compiling' | 'running'

interface LaunchMarker {
    kind: LaunchMarkerKind
    channelName: string
}

/** Parses a line as a launch-chain marker (a "Compiling"/"Running" console banner), or null. */
function parseLaunchMarker(text: string): LaunchMarker | null {
    const runningMatch = RUNNING_LINE_RE.exec(text)
    if (runningMatch) return { kind: 'running', channelName: runningMatch[1]! }
    const compilingMatch = COMPILING_LINE_RE.exec(text)
    if (compilingMatch) return { kind: 'compiling', channelName: compilingMatch[1]! }
    return null
}

export interface AppRunBoundaries {
    /** Per line, whether it belongs to an odd-numbered block (for the alternating tint). */
    tint: boolean[]
    /** Per line, whether it is a marker that actually starts a NEW block (see module doc). */
    blockStart: boolean[]
}

/**
 * Walks the buffer once, computing both the alternating tint flag and which marker
 * lines actually start a new block (as opposed to merging into the previous one).
 */
export function computeAppRunBoundaries(lineTexts: string[]): AppRunBoundaries {
    const tint: boolean[] = new Array(lineTexts.length)
    const blockStart: boolean[] = new Array(lineTexts.length)
    let blockCount = 0
    let currentBlockChannel: string | null = null
    let currentBlockHasRun = false
    for (let i = 0; i < lineTexts.length; i++) {
        const marker = parseLaunchMarker(lineTexts[i]!)
        if (marker) {
            const continuesCurrentBlock = currentBlockChannel === marker.channelName && !currentBlockHasRun
            if (continuesCurrentBlock) {
                blockStart[i] = false
            } else {
                blockCount++
                blockStart[i] = true
                currentBlockChannel = marker.channelName
                currentBlockHasRun = false
            }
            if (marker.kind === 'running') currentBlockHasRun = true
        } else {
            blockStart[i] = false
        }
        tint[i] = blockCount % 2 === 1
    }
    return { tint, blockStart }
}

/**
 * Builds the CSS linear-gradient for the row carrying the accent divider, so the run-tint
 * color change and the divider line always land on the exact same pixel instead of drifting
 * apart. `centered` places the divider in the middle of the row (used for a blank row, which
 * has no text to hug) instead of at its bottom edge. A bottom-anchored divider needs no
 * `afterColor`: nothing of this row is painted below the divider, so the next run's tint
 * starts on the next row.
 */
export function buildRunBoundaryGradient(options: {
    rowHeightPx: number
    dividerThicknessPx: number
    centered: boolean
    beforeColor: string
    afterColor: string
    accentColor: string
}): string {
    const { rowHeightPx, dividerThicknessPx, centered, beforeColor, afterColor, accentColor } = options
    if (!centered) {
        const start = ((rowHeightPx - dividerThicknessPx) / rowHeightPx) * 100
        return `linear-gradient(to bottom, ${beforeColor} 0%, ${beforeColor} ${start}%, ${accentColor} ${start}%, ${accentColor} 100%)`
    }
    const start = ((rowHeightPx - dividerThicknessPx) / 2 / rowHeightPx) * 100
    const end = ((rowHeightPx + dividerThicknessPx) / 2 / rowHeightPx) * 100
    return (
        `linear-gradient(to bottom, ${beforeColor} 0%, ${beforeColor} ${start}%, ${accentColor} ${start}%, `
        + `${accentColor} ${end}%, ${afterColor} ${end}%, ${afterColor} 100%)`
    )
}
