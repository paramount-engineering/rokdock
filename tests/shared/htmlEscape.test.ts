import { describe, it, expect } from 'vitest'
import { escapeHtml } from '@shared/htmlEscape'

describe('escapeHtml', () => {
    it('escapes ampersand', () => {
        expect(escapeHtml('a&b')).toBe('a&amp;b')
    })
    it('escapes less-than and greater-than', () => {
        expect(escapeHtml('<b>')).toBe('&lt;b&gt;')
    })
    it('escapes double-quote', () => {
        expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;')
    })
    it('escapes all four characters together', () => {
        expect(escapeHtml('<a href="&amp;">')).toBe('&lt;a href=&quot;&amp;amp;&quot;&gt;')
    })
    it('converts null to empty string', () => {
        expect(escapeHtml(null)).toBe('')
    })
    it('converts undefined to empty string', () => {
        expect(escapeHtml(undefined)).toBe('')
    })
    it('converts numbers to their string form', () => {
        expect(escapeHtml(42)).toBe('42')
    })
    it('passes through plain text unchanged', () => {
        expect(escapeHtml('hello world')).toBe('hello world')
    })
})
