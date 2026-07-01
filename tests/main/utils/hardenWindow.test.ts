import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shell } from 'electron'
import { isWebUrl, shouldAllowNavigation, hardenWindowNavigation } from '@main/utils/hardenWindow'

vi.mock('electron', () => ({
    shell: { openExternal: vi.fn(async () => {}) },
}))

const FILE_SHELL = 'file:///C:/app/out/renderer/index.html'
const DEV_SHELL = 'http://localhost:5173/index.html'

describe('isWebUrl', () => {
    it('is true only for http and https', () => {
        expect(isWebUrl('http://example.com')).toBe(true)
        expect(isWebUrl('https://developer.roku.com/x')).toBe(true)
        expect(isWebUrl('file:///etc/passwd')).toBe(false)
        expect(isWebUrl('mailto:a@b.com')).toBe(false)
        expect(isWebUrl('not a url')).toBe(false)
    })
})

describe('shouldAllowNavigation', () => {
    it('allows a reload of the same bundled file', () => {
        expect(shouldAllowNavigation(FILE_SHELL, FILE_SHELL)).toBe(true)
    })
    it('blocks a file link to a different local path', () => {
        expect(shouldAllowNavigation(FILE_SHELL, 'file:///etc/passwd')).toBe(false)
    })
    it('allows same-origin navigation under the dev server', () => {
        expect(shouldAllowNavigation(DEV_SHELL, 'http://localhost:5173/foo')).toBe(true)
    })
    it('blocks an external web link from the file shell', () => {
        expect(shouldAllowNavigation(FILE_SHELL, 'https://developer.roku.com/page')).toBe(false)
    })
    it('blocks an external web link from the dev server', () => {
        expect(shouldAllowNavigation(DEV_SHELL, 'https://developer.roku.com')).toBe(false)
    })
    it('blocks an unparseable target', () => {
        expect(shouldAllowNavigation(FILE_SHELL, 'http://')).toBe(false)
    })
})

/** A minimal fake webContents that captures the registered handlers. */
function fakeWindow(currentUrl: string) {
    const captured: { openHandler?: (d: { url: string }) => unknown; navHandler?: (e: { preventDefault: () => void }, url: string) => void } = {}
    const win = {
        webContents: {
            getURL: () => currentUrl,
            setWindowOpenHandler: (fn: (d: { url: string }) => unknown) => { captured.openHandler = fn },
            on: (event: string, fn: (e: { preventDefault: () => void }, url: string) => void) => { if (event === 'will-navigate') captured.navHandler = fn },
        },
    }
    return { win, captured }
}

describe('hardenWindowNavigation', () => {
    beforeEach(() => vi.mocked(shell.openExternal).mockClear())

    it('denies window.open and opens a web popup target in the browser', () => {
        const { win, captured } = fakeWindow(FILE_SHELL)
        hardenWindowNavigation(win as never)
        const result = captured.openHandler!({ url: 'https://developer.roku.com/x' })
        expect(result).toEqual({ action: 'deny' })
        expect(shell.openExternal).toHaveBeenCalledWith('https://developer.roku.com/x')
    })

    it('prevents an external top-level navigation and opens it in the browser', () => {
        const { win, captured } = fakeWindow(FILE_SHELL)
        hardenWindowNavigation(win as never)
        const event = { preventDefault: vi.fn() }
        captured.navHandler!(event, 'https://developer.roku.com/Content-metadata')
        expect(event.preventDefault).toHaveBeenCalledOnce()
        expect(shell.openExternal).toHaveBeenCalledWith('https://developer.roku.com/Content-metadata')
    })

    it('allows a same-document reload to proceed', () => {
        const { win, captured } = fakeWindow(FILE_SHELL)
        hardenWindowNavigation(win as never)
        const event = { preventDefault: vi.fn() }
        captured.navHandler!(event, FILE_SHELL)
        expect(event.preventDefault).not.toHaveBeenCalled()
        expect(shell.openExternal).not.toHaveBeenCalled()
    })

    it('prevents a non-web off-path navigation without opening anything externally', () => {
        const { win, captured } = fakeWindow(FILE_SHELL)
        hardenWindowNavigation(win as never)
        const event = { preventDefault: vi.fn() }
        captured.navHandler!(event, 'file:///etc/passwd')
        expect(event.preventDefault).toHaveBeenCalledOnce()
        expect(shell.openExternal).not.toHaveBeenCalled()
    })
})
