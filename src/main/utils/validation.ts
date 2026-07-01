/**
 * Input validation and sanitization utilities for IPC handler arguments.
 *
 * These functions guard IPC boundaries where renderer-supplied values are used
 * in main-process operations (file I/O, network requests, store writes). All
 * type predicates narrow `unknown` to specific types for safe downstream use.
 *
 * escapeHtml() is used for values inserted into HTML templates to prevent
 * injection in generated tool window pages.
 */

import { AUTO_REFRESH_INTERVALS_SEC } from '../constants/preview'
import type { PanelState } from '../../shared/types'

/**
 * Clamps a number to the inclusive range [min, max] and rounds it to the nearest integer.
 *
 * @param value - The input number to clamp.
 * @param min - Minimum allowed value (inclusive).
 * @param max - Maximum allowed value (inclusive).
 * @returns The clamped and rounded integer.
 */
export function clampInt(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Math.round(value)))
}

/**
 * Type predicate that returns true when value is a non-empty string (after trimming).
 *
 * @param value - Unknown value from an IPC argument or store read.
 * @returns True if value is a string with at least one non-whitespace character.
 */
export function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0
}

/**
 * Type predicate that returns true when value is a valid TCP/UDP port number (1-65535).
 *
 * @param value - Unknown value to check.
 * @returns True if value is an integer in the range 1-65535.
 */
export function isValidPort(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65535
}

/**
 * Coerces an unknown value to a valid theme mode string. Defaults to 'dark' for
 * any value other than the exact string 'light'.
 *
 * @param value - Unknown value (typically read from the electron-store).
 * @returns 'light' or 'dark'.
 */
export function asThemeMode(value: unknown): 'dark' | 'light' {
    return value === 'light' ? 'light' : 'dark'
}

/**
 * Type predicate that returns true when value is a valid panel state object with
 * boolean leftOpen and rightOpen fields, optional numeric leftWidth / leftSplit /
 * rightWidth / aiChatDrawerHeight, optional boolean aiChatOpen, and an optional
 * aiChatDock of 'left' | 'middle' | 'right'.
 *
 * @param value - Unknown value from a store read or IPC argument.
 * @returns True if value matches { leftOpen: boolean, rightOpen: boolean, leftWidth?: number, leftSplit?: number, rightWidth?: number, aiChatOpen?: boolean, aiChatDock?: 'left' | 'middle' | 'right', aiChatDrawerHeight?: number }.
 */
export function isValidPanelState(value: unknown): value is PanelState {
    if (!value || typeof value !== 'object') return false
    const candidate = value as { leftOpen?: unknown; rightOpen?: unknown; leftWidth?: unknown; leftSplit?: unknown; rightWidth?: unknown; aiChatOpen?: unknown; aiChatDock?: unknown; aiChatDrawerHeight?: unknown }
    if (typeof candidate.leftOpen !== 'boolean' || typeof candidate.rightOpen !== 'boolean') return false
    if (candidate.leftWidth !== undefined && typeof candidate.leftWidth !== 'number') return false
    if (candidate.leftSplit !== undefined && typeof candidate.leftSplit !== 'number') return false
    if (candidate.rightWidth !== undefined && typeof candidate.rightWidth !== 'number') return false
    if (candidate.aiChatOpen !== undefined && typeof candidate.aiChatOpen !== 'boolean') return false
    if (candidate.aiChatDock !== undefined && candidate.aiChatDock !== 'left' && candidate.aiChatDock !== 'middle' && candidate.aiChatDock !== 'right') return false
    if (candidate.aiChatDrawerHeight !== undefined && typeof candidate.aiChatDrawerHeight !== 'number') return false
    return true
}

/**
 * Snaps an arbitrary refresh interval (in seconds) to the nearest value in the
 * AUTO_REFRESH_INTERVALS_SEC allowed set. The input is first clamped to [min, max]
 * of the allowed set before finding the nearest allowed option.
 *
 * @param value - Desired auto-refresh interval in seconds (may be out of range).
 * @returns The nearest allowed interval value from AUTO_REFRESH_INTERVALS_SEC.
 */
export function normalizeAutoRefreshIntervalSec(value: number): number {
    const min = AUTO_REFRESH_INTERVALS_SEC[0]
    const max = AUTO_REFRESH_INTERVALS_SEC[AUTO_REFRESH_INTERVALS_SEC.length - 1]
    const rounded = clampInt(value, min, max)
    let nearest: (typeof AUTO_REFRESH_INTERVALS_SEC)[number] = AUTO_REFRESH_INTERVALS_SEC[0]
    let nearestDelta = Math.abs(rounded - nearest)
    for (const option of AUTO_REFRESH_INTERVALS_SEC) {
        const delta = Math.abs(rounded - option)
        if (delta < nearestDelta) {
            nearest = option
            nearestDelta = delta
        }
    }
    return nearest
}

/**
 * Type predicate that validates an IPv4 address string (Roku devices are IPv4 only).
 * Checks the dotted-decimal format and ensures each octet is in range 0-255.
 *
 * @param value - Unknown value to check.
 * @returns True if value is a valid IPv4 address string.
 */
export function isValidIp(value: unknown): value is string {
    if (typeof value !== 'string') return false
    const trimmed = value.trim()
    // IPv4 only (Roku devices are IPv4)
    return /^(\d{1,3}\.){3}\d{1,3}$/.test(trimmed)
        && trimmed.split('.').every(seg => Number(seg) <= 255)
}

/**
 * Returns true when value is a valid port monitor configuration object, requiring
 * a valid port number, a label string, a color string, and a boolean enabled flag.
 *
 * @param value - Unknown value from a store read or IPC argument.
 * @returns True if value is a well-formed port configuration object.
 */
export function isValidPortConfig(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false
    const candidate = value as Record<string, unknown>
    return isValidPort(candidate.port)
        && typeof candidate.label === 'string'
        && typeof candidate.color === 'string'
        && typeof candidate.enabled === 'boolean'
}

/**
 * Returns true when value is a valid deeplink configuration object. Requires id, name,
 * type ('launch' or 'input'), appId, mediaType, contentId strings, and an extraParams
 * array of { key: string; value: string } objects.
 *
 * @param value - Unknown value from a store read or IPC argument.
 * @returns True if value is a well-formed deeplink configuration object.
 */
export function isValidDeeplinkConfig(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false
    const candidate = value as Record<string, unknown>
    if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') return false
    if (candidate.type !== 'launch' && candidate.type !== 'input') return false
    if (typeof candidate.appId !== 'string') return false
    if (typeof candidate.mediaType !== 'string') return false
    if (typeof candidate.contentId !== 'string') return false
    if (!Array.isArray(candidate.extraParams)) return false
    return (candidate.extraParams as unknown[]).every(param => {
        if (!param || typeof param !== 'object') return false
        const paramObj = param as Record<string, unknown>
        return typeof paramObj.key === 'string' && typeof paramObj.value === 'string'
    })
}

/**
 * Escapes special HTML characters in a string to prevent injection in generated
 * tool window HTML templates. Replaces &, <, >, ", and ' with their HTML entities.
 *
 * @param value - Raw string value to escape.
 * @returns HTML-safe string with special characters replaced by entities.
 */
export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}
