import { describe, it, expect } from 'vitest'
import { extractTokens, substituteTokens, validateScript } from '@shared/script'
import type { Step } from '@shared/script'

// ---------------------------------------------------------------------------
// substituteTokens
// ---------------------------------------------------------------------------

describe('substituteTokens', () => {
    it('substitutes a present variable', () => {
        expect(substituteTokens('hello ${name}', { name: 'world' })).toBe('hello world')
    })

    it('substitutes multiple variables in one string', () => {
        expect(substituteTokens('${a} and ${b}', { a: 'foo', b: 'bar' })).toBe('foo and bar')
    })

    it('substitutes the same variable appearing multiple times', () => {
        expect(substituteTokens('${x} ${x}', { x: 'hi' })).toBe('hi hi')
    })

    it('leaves the token literal when the variable is not in the map', () => {
        expect(substituteTokens('value=${missing}', {})).toBe('value=${missing}')
    })

    it('substitutes present variables and preserves missing ones in the same string', () => {
        expect(substituteTokens('${a} ${b}', { a: 'found' })).toBe('found ${b}')
    })

    it('returns an unchanged string when there are no tokens', () => {
        expect(substituteTokens('no tokens here', { x: 'y' })).toBe('no tokens here')
    })

    it('handles an empty string', () => {
        expect(substituteTokens('', {})).toBe('')
    })

    it('handles a token whose replacement value is an empty string', () => {
        expect(substituteTokens('prefix${x}suffix', { x: '' })).toBe('prefixsuffix')
    })

    it('does not substitute a partial token pattern missing the closing brace', () => {
        // "${name" has no closing brace - not matched by the regex
        expect(substituteTokens('${name', { name: 'value' })).toBe('${name')
    })

    it('does not substitute a dollar sign not followed by braces', () => {
        expect(substituteTokens('cost is $5.00', { '5.00': 'X' })).toBe('cost is $5.00')
    })

    it('handles a variable name containing non-alpha characters', () => {
        expect(substituteTokens('${my.var}', { 'my.var': 'ok' })).toBe('ok')
    })
})

// ---------------------------------------------------------------------------
// extractTokens
// ---------------------------------------------------------------------------

describe('extractTokens', () => {
    it('returns an empty array for steps with no text steps', () => {
        const steps: Step[] = [
            { type: 'press', key: 'Home' },
            { type: 'delay', durationMs: 1000 }
        ]
        expect(extractTokens(steps)).toEqual([])
    })

    it('extracts a single token from a text step', () => {
        const steps: Step[] = [{ type: 'text', value: '${username}' }]
        expect(extractTokens(steps)).toEqual(['username'])
    })

    it('extracts multiple distinct tokens from a single text step', () => {
        const steps: Step[] = [{ type: 'text', value: '${a} ${b} ${c}' }]
        const tokens = extractTokens(steps)
        expect(tokens).toContain('a')
        expect(tokens).toContain('b')
        expect(tokens).toContain('c')
        expect(tokens).toHaveLength(3)
    })

    it('deduplicates the same token appearing in multiple text steps', () => {
        const steps: Step[] = [
            { type: 'text', value: '${user}' },
            { type: 'text', value: 'hello ${user}' }
        ]
        const tokens = extractTokens(steps)
        expect(tokens.filter(token => token === 'user')).toHaveLength(1)
    })

    it('deduplicates the same token appearing twice in one text step', () => {
        const steps: Step[] = [{ type: 'text', value: '${x} and ${x}' }]
        const tokens = extractTokens(steps)
        expect(tokens.filter(token => token === 'x')).toHaveLength(1)
    })

    it('extracts tokens from text steps nested inside a loop step', () => {
        const steps: Step[] = [{
            type: 'loop',
            iterations: 3,
            steps: [{ type: 'text', value: '${loopVar}' }]
        }]
        const tokens = extractTokens(steps)
        expect(tokens).toContain('loopVar')
    })

    it('extracts tokens from both top-level and nested loop text steps', () => {
        const steps: Step[] = [
            { type: 'text', value: '${top}' },
            {
                type: 'loop',
                iterations: 1,
                steps: [{ type: 'text', value: '${nested}' }]
            }
        ]
        const tokens = extractTokens(steps)
        expect(tokens).toContain('top')
        expect(tokens).toContain('nested')
    })

    it('does not extract tokens from non-text step types', () => {
        const steps: Step[] = [
            { type: 'screenshot', marker: '${marker}' },
            { type: 'press', key: '${key}' }
        ]
        // extractTokens only scans 'text' steps - marker and key fields are not scanned
        const tokens = extractTokens(steps)
        expect(tokens).toHaveLength(0)
    })

    it('returns an empty array for an empty steps array', () => {
        expect(extractTokens([])).toEqual([])
    })

    it('returns an empty array for a text step with no tokens', () => {
        const steps: Step[] = [{ type: 'text', value: 'no tokens here' }]
        expect(extractTokens(steps)).toEqual([])
    })
})

// ---------------------------------------------------------------------------
// validateScript (guards a parsed/imported ScriptFile before the engine runs)
// ---------------------------------------------------------------------------

describe('validateScript', () => {
    it('returns null for a well-formed script', () => {
        expect(validateScript({ version: 1, name: 'Test', steps: [] })).toBeNull()
    })

    it('rejects non-objects', () => {
        expect(validateScript(null)).toBe('Script must be an object')
        expect(validateScript('script')).toBe('Script must be an object')
        expect(validateScript(42)).toBe('Script must be an object')
    })

    it('rejects a wrong or missing version', () => {
        expect(validateScript({ version: 2, name: 'x', steps: [] })).toBe('Script version must be 1')
        expect(validateScript({ name: 'x', steps: [] })).toBe('Script version must be 1')
    })

    it('rejects a non-string name', () => {
        expect(validateScript({ version: 1, name: 5, steps: [] })).toBe('Script name must be a string')
    })

    it('rejects non-array steps', () => {
        expect(validateScript({ version: 1, name: 'x', steps: 'nope' })).toBe('Script steps must be an array')
        expect(validateScript({ version: 1, name: 'x' })).toBe('Script steps must be an array')
    })
})
