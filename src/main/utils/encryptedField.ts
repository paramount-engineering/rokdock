/**
 * Shared codec for fields encrypted at rest with Electron's safeStorage API
 * (OS keychain-backed). Encrypted values are stored as `enc:<base64>` so they
 * are distinguishable from legacy plaintext.
 *
 * This module owns only the mechanical part: the prefix, the base64 codec, and
 * the safeStorage calls. Policy stays at each call site, because it differs:
 *  - StoreService falls back to plaintext when encryption is unavailable (for
 *    portability) and treats a non-prefixed value as legacy plaintext to migrate.
 *  - AiProfileStore throws when encryption is unavailable (API keys must never be
 *    written in plaintext) and rejects any non-prefixed value.
 *
 * decryptField therefore returns undefined for both "not encrypted" and
 * "unreadable", leaving each caller to layer its own handling on top.
 */

import { safeStorage } from 'electron'

export const ENC_PREFIX = 'enc:'

/** True when the stored value carries the encrypted-field prefix. */
export function isEncrypted(value: string): boolean {
    return value.startsWith(ENC_PREFIX)
}

/**
 * Encrypts a string to `enc:<base64>`. The caller must first decide what to do
 * when encryption is unavailable (fall back to plaintext, or throw) by checking
 * `safeStorage.isEncryptionAvailable()`. This helper assumes it is available.
 *
 * @param value - Plaintext string to encrypt.
 * @returns `'enc:<base64>'`.
 */
export function encryptToField(value: string): string {
    return ENC_PREFIX + safeStorage.encryptString(value).toString('base64')
}

/**
 * Decrypts a value previously produced by `encryptToField`.
 *
 * @param value - Raw stored string.
 * @returns The decrypted plaintext, or `undefined` if the value is not
 *   `enc:`-prefixed or its ciphertext cannot be decrypted.
 */
export function decryptField(value: string): string | undefined {
    if (!isEncrypted(value)) return undefined
    try {
        return safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), 'base64'))
    } catch {
        return undefined
    }
}
