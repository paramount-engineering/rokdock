import { describe, it, expect } from 'vitest'
import { brightscriptStreamParser } from '@renderer/docs/highlight/brightscript'

// Minimal StringStream stand-in covering the methods the parser calls.
class MockStream {
    pos = 0
    start = 0
    constructor(public string: string) {}
    eol() { return this.pos >= this.string.length }
    sol() { return this.pos === 0 }
    peek() { return this.string[this.pos] }
    next() { return this.string[this.pos++] }
    eat(match: string | RegExp): string | undefined {
        const ch = this.string[this.pos]
        if (ch === undefined) return undefined
        const ok = typeof match === 'string' ? ch === match : match.test(ch)
        if (ok) { this.pos++; return ch }
        return undefined
    }
    eatWhile(match: string | RegExp): boolean {
        const startPos = this.pos
        while (this.eat(match)) { /* advance */ }
        return this.pos > startPos
    }
    eatSpace() { return this.eatWhile(/\s/) }
    skipToEnd() { this.pos = this.string.length }
    match(pattern: string | RegExp, consume = true): boolean | RegExpMatchArray | null {
        if (typeof pattern === 'string') {
            const hit = this.string.slice(this.pos).toLowerCase().startsWith(pattern.toLowerCase())
            if (hit && consume) this.pos += pattern.length
            return hit
        }
        const match = this.string.slice(this.pos).match(pattern)
        if (match && match.index === 0) { if (consume) this.pos += match[0].length; return match }
        return null
    }
    current() { return this.string.slice(this.start, this.pos) }
}

function styles(code: string): string[] {
    const out: string[] = []
    const stream = new MockStream(code) as any
    const state = brightscriptStreamParser.startState ? brightscriptStreamParser.startState() : {}
    let guard = 0
    while (!stream.eol() && guard++ < 1000) {
        stream.start = stream.pos
        const before = stream.pos
        const style = brightscriptStreamParser.token(stream, state)
        if (stream.pos === before) stream.pos++   // ensure progress
        if (style) out.push(style)
    }
    return out
}

it('tags keywords', () => { expect(styles('sub')).toContain('keyword') })
it('tags strings', () => { expect(styles('"hi"')).toContain('string') })
it('tags apostrophe comments', () => { expect(styles("' a comment")).toContain('comment') })
it('tags REM comments', () => { expect(styles('REM old comment')).toContain('comment') })
it('tags decimal numbers', () => { expect(styles('42')).toContain('number') })
it('tags hex numbers', () => { expect(styles('&hFF')).toContain('number') })
it('tags function/sub keyword in context', () => { expect(styles('function Main()')).toContain('keyword') })
