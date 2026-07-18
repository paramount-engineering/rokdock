import { describe, it, expect } from 'vitest'
import { compileLineFilter } from '@shared/lineFilter'

describe('compileLineFilter', () => {
    it('treats an empty pattern as no filter', () => {
        expect(compileLineFilter('')).toEqual({ regex: null, error: null })
    })

    it('compiles a valid pattern to a non-global regex', () => {
        const { regex, error } = compileLineFilter('ERROR|WARN')
        expect(error).toBeNull()
        expect(regex).toBeInstanceOf(RegExp)
        expect(regex?.global).toBe(false)
        expect(regex?.test('a WARN line')).toBe(true)
        // Non-global: repeated tests are stateless.
        expect(regex?.test('a WARN line')).toBe(true)
    })

    it('reports an error for an invalid pattern and yields no regex', () => {
        const { regex, error } = compileLineFilter('[unterminated')
        expect(regex).toBeNull()
        expect(error).toBeTruthy()
    })
})
