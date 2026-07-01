import { describe, it, expect } from 'vitest'
import { markdownToPlainText, extractLinkTargets } from '@shared/docs/plainText'

describe('markdownToPlainText', () => {
    it('strips emphasis, links, and inline code to bare words', () => {
        expect(markdownToPlainText('See **bold**, _italic_, `code`, and [a link](https://x).')).toBe(
            'See bold, italic, code, and a link.',
        )
    })

    it('drops code-fence delimiters but keeps the code body', () => {
        const md = '```brightscript\nsub Main()\nend sub\n```'
        expect(markdownToPlainText(md)).toBe('sub Main() end sub')
    })

    it('strips heading, list, and blockquote markers', () => {
        const md = '## Title\n\n- one\n- two\n\n> a quote'
        expect(markdownToPlainText(md)).toBe('Title one two a quote')
    })

    it('reduces a markdown table to its cell text', () => {
        const md = '| Field | Type |\n| --- | --- |\n| name | String |'
        expect(markdownToPlainText(md)).toBe('Field Type name String')
    })

    it('removes HTML tags and unescapes backslash escapes', () => {
        expect(markdownToPlainText('a <strong>b</strong> c \\{ d \\}')).toBe('a b c { d }')
    })

    it('treats a fence-language change as the same plain text', () => {
        const before = '```\nx = 1\n```'
        const after = '```brightscript\nx = 1\n```'
        expect(markdownToPlainText(before)).toBe(markdownToPlainText(after))
    })
})

describe('extractLinkTargets', () => {
    it('collects markdown link and image targets in order', () => {
        const md = 'See [docs](https://a.com/x) and ![pic](https://b.com/img.png).'
        expect(extractLinkTargets(md)).toBe('https://a.com/x\nhttps://b.com/img.png')
    })

    it('collects autolinks and HTML href/src attributes', () => {
        const md = '<https://auto.link> <a href="https://h.com">x</a> <img src="https://i.com/p.png">'
        expect(extractLinkTargets(md)).toBe('https://auto.link\nhttps://h.com\nhttps://i.com/p.png')
    })

    it('returns empty for text with no links', () => {
        expect(extractLinkTargets('just plain words here')).toBe('')
    })

    it('distinguishes a changed href from an unchanged one (the filter relies on this)', () => {
        const before = 'Read [the guide](https://old.example/path).'
        const after = 'Read [the guide](https://new.example/path).'
        // Plain text is identical, but the targets differ -> a real change.
        expect(markdownToPlainText(before)).toBe(markdownToPlainText(after))
        expect(extractLinkTargets(before)).not.toBe(extractLinkTargets(after))
    })
})
