import { describe, it, expect, beforeEach } from 'vitest'
import { getScopedToolWindow, setScopedToolWindow, resetScopedToolWindowsForTest } from '@main/ipc/toolWindow'

// Minimal fake of the BrowserWindow surface the registry touches.
function fakeWin() {
    const listeners: Record<string, () => void> = {}
    return {
        destroyed: false,
        focused: 0,
        isDestroyed() { return this.destroyed },
        on(event: string, callback: () => void) { listeners[event] = callback },
        focus() { this.focused++ },
        emitClosed() { this.destroyed = true; listeners['closed']?.() },
    }
}

describe('scoped tool-window registry', () => {
    beforeEach(() => resetScopedToolWindowsForTest())

    it('returns null for an unregistered key', () => {
        expect(getScopedToolWindow('json', 'standalone')).toBeNull()
    })

    it('records a window and returns it while live', () => {
        const w = fakeWin()
        setScopedToolWindow('json', 'standalone', w as never)
        expect(getScopedToolWindow('json', 'standalone')).toBe(w)
    })

    it('drops the entry when the window closes', () => {
        const w = fakeWin()
        setScopedToolWindow('json', 'standalone', w as never)
        w.emitClosed()
        expect(getScopedToolWindow('json', 'standalone')).toBeNull()
    })

    it('treats a destroyed window as absent', () => {
        const w = fakeWin()
        setScopedToolWindow('json', 'standalone', w as never)
        w.destroyed = true
        expect(getScopedToolWindow('json', 'standalone')).toBeNull()
    })

    it('keeps scopes and tools independent', () => {
        const windowA = fakeWin(); const windowB = fakeWin()
        setScopedToolWindow('json', 'standalone', windowA as never)
        setScopedToolWindow('json', 'inDock', windowB as never)
        expect(getScopedToolWindow('json', 'standalone')).toBe(windowA)
        expect(getScopedToolWindow('json', 'inDock')).toBe(windowB)
    })
})
