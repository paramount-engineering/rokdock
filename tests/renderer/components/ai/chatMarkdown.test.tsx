// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import ChatMarkdown from '@renderer/components/ai/chatMarkdown'

describe('ChatMarkdown', () => {
    it('renders headings and inline formatting', () => {
        const { container } = render(<ChatMarkdown text={'# Title\n\nsome **bold** text'} />)
        expect(container.querySelector('h1')?.textContent).toBe('Title')
        expect(container.querySelector('strong')?.textContent).toBe('bold')
    })
    it('renders fenced code blocks', () => {
        const { container } = render(<ChatMarkdown text={'```\nprint "hi"\n```'} />)
        const code = container.querySelector('pre code')
        expect(code?.textContent).toContain('print "hi"')
    })

    it('links a known symbol in prose and opens it on click', () => {
        const lookUp = vi.fn()
        ;(window as never as { rokdock: unknown }).rokdock = { docs: { lookUp } }
        const { getByText } = render(<ChatMarkdown text="Use roSGNode to build UI." symbols={{ roSGNode: 'SceneGraph/roSGNode.md' }} />)
        fireEvent.click(getByText('roSGNode'))
        expect(lookUp).toHaveBeenCalledWith('roSGNode')
    })

    it('opens a model-emitted web link in the system browser instead of navigating', () => {
        const openUrl = vi.fn()
        ;(window as never as { rokdock: unknown }).rokdock = { external: { openUrl } }
        const { getByText } = render(<ChatMarkdown text="See [the docs](https://developer.roku.com/docs/x)." />)
        const link = getByText('the docs') as HTMLAnchorElement
        const defaultPrevented = !fireEvent.click(link)
        expect(openUrl).toHaveBeenCalledWith('https://developer.roku.com/docs/x')
        expect(defaultPrevented).toBe(true)
    })

    it('links a symbol inside inline code and opens it on click', () => {
        const lookUp = vi.fn()
        ;(window as never as { rokdock: unknown }).rokdock = { docs: { lookUp } }
        const { container } = render(<ChatMarkdown text="Call `roSGNode` here." />)
        const button = container.querySelector('code button')
        expect(button?.textContent).toBe('roSGNode')
        fireEvent.click(button!)
        expect(lookUp).toHaveBeenCalledWith('roSGNode')
    })

    it('does not link inside fenced code blocks', () => {
        const { container } = render(<ChatMarkdown text={'```\nroSGNode here\n```'} />)
        expect(container.querySelector('pre code button')).toBeNull()
    })

    it('syntax-highlights a fenced block and exposes a Copy button that copies the code', () => {
        const writeText = vi.fn().mockResolvedValue(undefined)
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
        const { container } = render(<ChatMarkdown text={'```brightscript\nsub Main()\nend sub\n```'} />)
        // Highlighter wraps keyword tokens in styled spans (inline color from theme vars).
        expect(container.querySelector('.ai-chat-code-wrap pre code span')).toBeTruthy()
        fireEvent.click(container.querySelector('.ai-chat-code-copy')!)
        expect(writeText).toHaveBeenCalledWith('sub Main()\nend sub')
    })

    it('links Roku-shaped symbols on shape alone, with no symbol map', () => {
        const { getByText } = render(<ChatMarkdown text="Call DrawRect on a roBitmap." symbols={{}} />)
        expect((getByText('DrawRect') as HTMLElement).tagName).toBe('BUTTON')
        expect((getByText('roBitmap') as HTMLElement).tagName).toBe('BUTTON')
    })

    it('links a single-word component only when it is a documented title', () => {
        const { getByText, container } = render(<ChatMarkdown text="A Poster, not a Sunset." symbols={{ Poster: 'p.md' }} />)
        expect((getByText('Poster') as HTMLElement).tagName).toBe('BUTTON')
        // Sunset is a single capitalized word that is not a known title and has no
        // Roku symbol shape, so it stays plain text.
        expect(Array.from(container.querySelectorAll('button')).map(button => button.textContent)).not.toContain('Sunset')
    })

    it('renders a blockquote for > markdown', () => {
        const { container } = render(<ChatMarkdown text={'> quoted excerpt'} />)
        const quote = container.querySelector('blockquote')
        expect(quote).toBeTruthy()
        expect(quote?.textContent).toContain('quoted excerpt')
    })

    it('does not link a plain word', () => {
        const { container } = render(<ChatMarkdown text="Use the box here." symbols={{}} />)
        expect(container.querySelector('button')).toBeNull()
    })
})
