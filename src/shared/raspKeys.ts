/**
 * Key mapping tables for RASP (Remote Automation Script Player) compatibility.
 *
 * RASP is Roku's official scripting format for automated testing. It uses its own
 * key identifiers ('home', 'ok', 'up', etc.) that differ from the ECP key names
 * sent over HTTP ('Home', 'Select', 'Up'). This module bridges the two namespaces.
 *
 * RASP_EXECUTION_KEYS: the 25 keys that execute successfully via ECP in RASP scripts.
 * RASP_PARTNER_KEYS: shortcut keys for streaming service channels (recorded by the UI
 *   but fail at RASP runtime - included for import accuracy and display purposes).
 *
 * Note on the trailing space in 'Sling TV ': this is a bug in the RASP source that
 * must be preserved for correct round-trip import/export compatibility.
 */

// RASP execution engine key map - sourced from Roku Remote Tool bundle.js
// These are the only 25 keys that execute successfully via ECP in RASP scripts.
// Keys outside this set produce a runtime error: "X is not a valid key code".

interface RaspKey {
    // RASP YAML key identifier (as written in the YAML file)
    rasp: string
    // ECP command sent to the device
    ecp: string
}

// The 25 keys recognized by the RASP execution engine runtime.
// Note: 'Sling TV ' has a trailing space - this is a bug in the RASP source that must be preserved.
const RASP_EXECUTION_KEYS: readonly RaspKey[] = [
    { rasp: 'home',       ecp: 'Home' },
    { rasp: 'ok',         ecp: 'Select' },
    { rasp: 'select',     ecp: 'Select' },
    { rasp: 'up',         ecp: 'Up' },
    { rasp: 'down',       ecp: 'Down' },
    { rasp: 'left',       ecp: 'Left' },
    { rasp: 'right',      ecp: 'Right' },
    { rasp: 'back',       ecp: 'Back' },
    { rasp: 'forward',    ecp: 'Fwd' },
    { rasp: 'reverse',    ecp: 'Rev' },
    { rasp: 'play/pause', ecp: 'Play' },
    { rasp: 'play',       ecp: 'Play' },
    { rasp: 'pause',      ecp: 'Play' },
    { rasp: 'repeat',     ecp: 'InstantReplay' },
    { rasp: 'info',       ecp: 'Info' },
    { rasp: 'search',     ecp: 'Search' },
    { rasp: 'enter',      ecp: 'Enter' },
    { rasp: 'text',       ecp: 'Lit_' },
    { rasp: 'vup',        ecp: 'VolumeUp' },
    { rasp: 'vdown',      ecp: 'VolumeDown' },
    { rasp: 'mute',       ecp: 'VolumeMute' },
    { rasp: 'input',      ecp: 'InputSource' },
    { rasp: '*',          ecp: 'Info' },
    { rasp: 'power',      ecp: 'Power' },
    { rasp: 'backspace',  ecp: 'Backspace' },
]

// Fast lookup set for validation
export const RASP_EXECUTION_KEY_SET = new Set(RASP_EXECUTION_KEYS.map(k => k.rasp))

// Partner channel keys - recorded by the UI but fail at RASP runtime.
// The trailing space on 'Sling TV ' is intentional (matches source bug).
const RASP_PARTNER_KEYS: readonly RaspKey[] = [
    { rasp: 'Netflix',         ecp: 'Partner1' },
    { rasp: 'Pandora',         ecp: 'Partner2' },
    { rasp: 'Crackle',         ecp: 'Partner3' },
    { rasp: 'VUDU',            ecp: 'Partner4' },
    { rasp: 'NOW TV',          ecp: 'Partner5' },
    { rasp: 'Channel Store',   ecp: 'Partner6' },
    { rasp: 'M-GO',            ecp: 'Partner7' },
    { rasp: 'Amazon Video',    ecp: 'Partner8' },
    { rasp: 'Blockbuster',     ecp: 'Partner9' },
    { rasp: 'Rdio',            ecp: 'Partner10' },
    { rasp: 'CinemaNow',       ecp: 'Partner11' },
    { rasp: 'Sling TV ',       ecp: 'Partner12' },
    { rasp: 'Hulu',            ecp: 'Partner13' },
    { rasp: 'Google Play',     ecp: 'Partner14' },
    { rasp: 'Cineplex',        ecp: 'Partner15' },
    { rasp: 'YouTube',         ecp: 'Partner16' },
    { rasp: 'Sky Store',       ecp: 'Partner17' },
    { rasp: 'HBO NOW',         ecp: 'Partner18' },
    { rasp: 'Showtime',        ecp: 'Partner19' },
    { rasp: 'Red Bull TV',     ecp: 'Partner20' },
    { rasp: 'Spotify',         ecp: 'Partner21' },
    { rasp: 'CBS News',        ecp: 'Partner22' },
    { rasp: 'Cinepolis Klic',  ecp: 'Partner23' },
    { rasp: 'TED',             ecp: 'Partner24' },
    { rasp: 'BLIM',            ecp: 'Partner25' },
    { rasp: 'PlaystationVue',  ecp: 'Partner26' },
    { rasp: 'VMedia',          ecp: 'Partner27' },
    { rasp: 'Starz',           ecp: 'Partner28' },
]

export const RASP_PARTNER_KEY_SET = new Set(RASP_PARTNER_KEYS.map(k => k.rasp))

// Map from RASP key identifier to ECP command (execution keys only)
export const RASP_KEY_TO_ECP = new Map(RASP_EXECUTION_KEYS.map(k => [k.rasp, k.ecp]))

// Canonical ECP-to-RASP map (first RASP key wins when multiple map to the same ECP command)
// e.g. Select -> 'ok' (not 'select'), Play -> 'play/pause', Info -> 'info' (not '*')
export const ECP_TO_RASP: ReadonlyMap<string, string> = new Map(
    RASP_EXECUTION_KEYS
        .filter((k, i, arr) => arr.findIndex(x => x.ecp === k.ecp) === i)
        .map(k => [k.ecp, k.rasp])
)
