/**
 * Pure redaction pass. Replaces caller-supplied sensitive strings (and a generic
 * IPv4 pattern) with labeled placeholders before a payload leaves the machine.
 * Knows nothing about Roku. The host supplies the secret set.
 */
import type { RedactSecrets, RedactionConfig, RedactionResult, RedactionReplacement } from './types'

const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Word-boundary-anchored literal replacement that counts hits. */
function replaceLiteral(text: string, literal: string, placeholder: string): { text: string; count: number } {
    if (!literal) return { text, count: 0 }
    const pattern = new RegExp(`\\b${escapeRegExp(literal)}\\b`, 'g')
    let count = 0
    const next = text.replace(pattern, () => { count++; return placeholder })
    return { text: next, count }
}

export function redact(text: string, secrets: RedactSecrets, config: RedactionConfig): RedactionResult {
    if (!config.enabled) return { text, replacements: [] }

    const tally = new Map<string, number>()
    const bump = (label: string, count: number): void => {
        if (count > 0) tally.set(label, (tally.get(label) ?? 0) + count)
    }

    let working = text

    for (const name of secrets.deviceNames) {
        const result = replaceLiteral(working, name, '[device]'); working = result.text; bump('device', result.count)
    }
    for (const serial of secrets.serials) {
        const result = replaceLiteral(working, serial, '[serial]'); working = result.text; bump('serial', result.count)
    }
    for (const ip of secrets.ips) {
        const result = replaceLiteral(working, ip, '[ip]'); working = result.text; bump('ip', result.count)
    }
    for (const { literal, label } of secrets.custom) {
        const result = replaceLiteral(working, literal, `[${label}]`); working = result.text; bump(label, result.count)
    }
    // Catch any remaining IPv4 not in the known list.
    let ipPatternCount = 0
    working = working.replace(IPV4, () => { ipPatternCount++; return '[ip]' })
    bump('ip', ipPatternCount)

    const replacements: RedactionReplacement[] = Array.from(tally, ([label, count]) => ({ label, count }))
    return { text: working, replacements }
}
