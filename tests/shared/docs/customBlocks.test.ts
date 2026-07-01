import { describe, it, expect } from 'vitest'
import { preprocessCustomBlocks } from '@shared/docs/customBlocks'

it('converts <Callout> to a callout container the renderer understands', () => {
    const out = preprocessCustomBlocks('<Callout theme="warn">Be careful</Callout>')
    expect(out).toContain(':::callout')
    expect(out).toContain('Be careful')
})
it('converts <BlockQuote> to a callout container', () => {
    expect(preprocessCustomBlocks('<BlockQuote>Note</BlockQuote>')).toContain(':::callout')
})
it('leaves a plain blockquote untouched', () => {
    expect(preprocessCustomBlocks('> a note')).toBe('> a note')
})
it('converts a parseable <RokuTable> to a markdown table', () => {
    const src = '<RokuTable columns={[{header:"A",accessor:"a"}]} data={[{a:"1"}]} />'
    const out = preprocessCustomBlocks(src)
    expect(out).toContain('| A |')
    expect(out).toContain('| 1 |')
})
it('falls back gracefully when RokuTable props do not parse', () => {
    const out = preprocessCustomBlocks('<RokuTable columns={weird} />')
    expect(out).toContain(':::callout')
})
it('converts <Image> JSX to a markdown image (with title)', () => {
    const out = preprocessCustomBlocks('<Image alt="roku - x" border={false} src="https://image.roku.com/abc/x.png" title="x" />')
    expect(out).toContain('![roku - x](https://image.roku.com/abc/x.png "x")')
})
it('converts <Image> without a title', () => {
    const out = preprocessCustomBlocks('<Image alt="y" src="https://files.readme.io/y.jpg" />')
    expect(out).toContain('![y](https://files.readme.io/y.jpg)')
})
it('drops an <Image> with no src', () => {
    expect(preprocessCustomBlocks('<Image alt="x" />').trim()).toBe('')
})
it('converts a self-closing <video> to a ::video directive with its attributes', () => {
    const src = '<video src="https://image.roku.com/x/v.mp4" poster="https://image.roku.com/x/v.jpg" width="720" height="480" controls />'
    const out = preprocessCustomBlocks(src)
    expect(out).toContain('::video{')
    expect(out).toContain('src="https://image.roku.com/x/v.mp4"')
    expect(out).toContain('poster="https://image.roku.com/x/v.jpg"')
    expect(out).toContain('width="720"')
    expect(out).toContain('height="480"')
})
it('converts a paired <video> with a nested <source> using the source src', () => {
    const src = '<video controls poster="https://image.roku.com/x/v.jpg"><source src="https://image.roku.com/x/v.mp4" type="video/mp4" /></video>'
    const out = preprocessCustomBlocks(src)
    expect(out).toContain('::video{')
    expect(out).toContain('src="https://image.roku.com/x/v.mp4"')
})
it('drops a <video> with no src', () => {
    expect(preprocessCustomBlocks('<video controls />').trim()).toBe('')
})
it('collapses blank lines inside a raw HTML table so it stays one block', () => {
    const src = [
        '<table>',
        '  <tr>',
        '    <td>a</td>',
        '',          // blank line that would terminate the HTML block
        '    <td>b</td>',
        '  </tr>',
        '</table>',
    ].join('\n')
    const out = preprocessCustomBlocks(src)
    // No blank line remains between <table> and </table>.
    const inner = out.slice(out.indexOf('<table'), out.indexOf('</table>') + 8)
    expect(/\n[ \t]*\n/.test(inner)).toBe(false)
    expect(out).toContain('<td>a</td>')
    expect(out).toContain('<td>b</td>')
})
it('collapses blank lines across a nested table to the outer close', () => {
    const src = '<table><tr><td>x\n\n<table><tr><td>y</td></tr></table>\n\nz</td></tr></table>'
    const out = preprocessCustomBlocks(src)
    expect(/\n[ \t]*\n/.test(out)).toBe(false)
    expect(out).toContain('<td>y</td>')
})
