import { describe, it, expect } from 'vitest'
import { redact } from '@ai-core/redaction'
import type { RedactSecrets } from '@ai-core/types'

const empty: RedactSecrets = { ips: [], deviceNames: [], serials: [], custom: [] }

describe('redact', () => {
    it('returns text unchanged and no replacements when disabled', () => {
        const secrets: RedactSecrets = { ...empty, ips: ['192.168.1.50'] }
        const result = redact('connect to 192.168.1.50', secrets, { enabled: false })
        expect(result.text).toBe('connect to 192.168.1.50')
        expect(result.replacements).toEqual([])
    })

    it('replaces known IP literals and a generic IPv4 pattern with [ip]', () => {
        const secrets: RedactSecrets = { ...empty, ips: ['192.168.1.50'] }
        const result = redact('host 192.168.1.50 and 10.0.0.2', secrets, { enabled: true })
        expect(result.text).toBe('host [ip] and [ip]')
        expect(result.replacements).toContainEqual({ label: 'ip', count: 2 })
    })

    it('replaces device names and serials with labeled placeholders', () => {
        const secrets: RedactSecrets = { ...empty, deviceNames: ['Living Room Roku'], serials: ['X005200ABCDE'] }
        const result = redact('Living Room Roku serial X005200ABCDE', secrets, { enabled: true })
        expect(result.text).toBe('[device] serial [serial]')
    })

    it('replaces custom labeled literals', () => {
        const secrets: RedactSecrets = { ...empty, custom: [{ literal: 'SuperSecretShow', label: 'title' }] }
        const result = redact('now playing SuperSecretShow', secrets, { enabled: true })
        expect(result.text).toBe('now playing [title]')
    })

    it('does not partially match inside longer tokens', () => {
        const secrets: RedactSecrets = { ...empty, deviceNames: ['Roku'] }
        const result = redact('Rokudock and Roku', secrets, { enabled: true })
        expect(result.text).toBe('Rokudock and [device]')
    })
})
