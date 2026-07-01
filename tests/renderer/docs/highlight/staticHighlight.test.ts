import { describe, it, expect } from 'vitest'
import { highlightToHtml, languageFor } from '@renderer/docs/highlight/staticHighlight'

it('returns null for an unknown language (caller renders plain)', () => {
    expect(languageFor('rust')).toBeNull()
})
it('returns null for languages we render plain (text, http)', () => {
    expect(languageFor('text')).toBeNull()
    expect(languageFor('http')).toBeNull()
})
it.each([
    ['bash', 'echo "hello $HOME"'],
    ['sh', 'ls -la /tmp'],
    ['c', '#include <stdio.h>\nint main() { return 0; }'],
    ['javascript', 'const x = 1\nfunction f() { return x }'],
    ['js', 'let y = [1, 2, 3]'],
    ['python', 'def f(x):\n    return x + 1'],
    ['py', 'import os\nprint(os.getcwd())'],
])('resolves a language and emits themed spans for %s', (lang, code) => {
    expect(languageFor(lang)).not.toBeNull()
    const html = highlightToHtml(code, lang)
    expect(html).toContain('<span')
    expect(html).toMatch(/var\(--rokdock-/)
})
it('highlights json into spans carrying themed color vars', () => {
    const html = highlightToHtml('{"a":1}', 'json')
    expect(html).toContain('<span')
    expect(html).toMatch(/var\(--rokdock-json-/)
})
it('escapes html in code text', () => {
    const html = highlightToHtml('<b>&', 'text')   // 'text' or unknown -> plain, but still escaped
    expect(html).toContain('&lt;b&gt;')
    expect(html).toContain('&amp;')
})
it('highlights brightscript keywords', () => {
    const html = highlightToHtml('sub Main()\n  print "hi"\nend sub', 'brightscript')
    expect(html).toContain('<span')
})
