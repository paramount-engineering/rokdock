import { describe, it, expect, vi } from 'vitest'
import { ENC_PREFIX, isEncrypted, encryptToField, decryptField } from '@main/utils/encryptedField'

// Reversible base64 "encryption" so the round trip is observable in tests.
vi.mock('electron', () => ({
    safeStorage: {
        isEncryptionAvailable: vi.fn(() => true),
        encryptString: (plaintext: string) => Buffer.from(`secret:${plaintext}`),
        decryptString: (cipherBuf: Buffer) => {
            const text = cipherBuf.toString()
            if (!text.startsWith('secret:')) throw new Error('bad ciphertext')
            return text.slice('secret:'.length)
        },
    },
}))

describe('encryptedField', () => {
    it('isEncrypted detects the enc: prefix', () => {
        expect(isEncrypted(`${ENC_PREFIX}abc`)).toBe(true)
        expect(isEncrypted('plain')).toBe(false)
        expect(isEncrypted('')).toBe(false)
    })

    it('round-trips a value through encryptToField and decryptField', () => {
        const field = encryptToField('hunter2')
        expect(field.startsWith(ENC_PREFIX)).toBe(true)
        expect(field).not.toContain('hunter2')
        expect(decryptField(field)).toBe('hunter2')
    })

    it('decryptField returns undefined for a value without the prefix', () => {
        expect(decryptField('hunter2')).toBeUndefined()
    })

    it('decryptField returns undefined for unreadable ciphertext', () => {
        // Prefixed, but the base64 payload does not decrypt under the mock codec.
        expect(decryptField(`${ENC_PREFIX}${Buffer.from('garbage').toString('base64')}`)).toBeUndefined()
    })
})
