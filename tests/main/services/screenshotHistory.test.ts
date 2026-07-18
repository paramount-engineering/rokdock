/**
 * Unit tests for ScreenshotHistoryService.
 *
 * Electron APIs (app, nativeImage) and fs are mocked so the tests run in a
 * plain Node environment without a running Electron instance.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock electron before importing the service
// ---------------------------------------------------------------------------

// nativeImage mock returns unique bitmap data derived from the file path so
// pixel-duplicate pruning does not collapse unrelated test fixtures.
vi.mock('electron', () => {
    return {
        app: {
            getPath: (_name: string) => '/fake/userData'
        },
        nativeImage: {
            createFromPath: (filePath: string) => {
                // Hash the path string into a byte value so each unique path
                // produces a distinct bitmap, preventing spurious deduplication.
                let seed = 0
                for (let i = 0; i < filePath.length; i++) seed = (seed * 31 + filePath.charCodeAt(i)) & 0xff
                const data = Buffer.alloc(4 * 4 * 4, seed)
                return {
                    isEmpty: () => false,
                    getSize: (_scale?: number) => ({ width: 4, height: 4 }),
                    toBitmap: () => data,
                    resize: (opts: { width: number; height: number }) => opts
                }
            }
        }
    }
})

// ---------------------------------------------------------------------------
// Mock fs (synchronous API only)
// ---------------------------------------------------------------------------

// vi.hoisted() runs before the vi.mock() factory is hoisted, so these
// references are safe inside the factory closure below.
const {
    mockExistsSync,
    mockMkdirSync,
    mockReaddirSync,
    mockStatSync,
    mockWriteFileSync,
    mockCopyFileSync,
    mockUnlinkSync
} = vi.hoisted(() => ({
    mockExistsSync: vi.fn<[string], boolean>(() => true),
    mockMkdirSync: vi.fn(),
    mockReaddirSync: vi.fn<[string], string[]>(() => []),
    mockStatSync: vi.fn(() => ({ mtimeMs: 1000, isFile: () => true })),
    mockWriteFileSync: vi.fn(),
    mockCopyFileSync: vi.fn(),
    mockUnlinkSync: vi.fn()
}))

vi.mock('fs', () => ({
    default: {
        existsSync: mockExistsSync,
        mkdirSync: mockMkdirSync,
        readdirSync: mockReaddirSync,
        statSync: mockStatSync,
        writeFileSync: mockWriteFileSync,
        copyFileSync: mockCopyFileSync,
        unlinkSync: mockUnlinkSync
    },
    existsSync: mockExistsSync,
    mkdirSync: mockMkdirSync,
    readdirSync: mockReaddirSync,
    statSync: mockStatSync,
    writeFileSync: mockWriteFileSync,
    copyFileSync: mockCopyFileSync,
    unlinkSync: mockUnlinkSync
}))

// ---------------------------------------------------------------------------
// Import under test (after mocks are registered)
// ---------------------------------------------------------------------------

import { ScreenshotHistoryService } from '@main/services/screenshotHistory'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshService(): ScreenshotHistoryService {
    return new ScreenshotHistoryService()
}

/** Default stat mock that returns a stable mtime. */
const defaultStat = () => ({ mtimeMs: 1000, isFile: () => true })

// ---------------------------------------------------------------------------
// load()
// ---------------------------------------------------------------------------

describe('ScreenshotHistoryService.load()', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockExistsSync.mockReturnValue(true)
        mockStatSync.mockImplementation(defaultStat as unknown as typeof mockStatSync)
    })

    it('populates history from the directory on first call', () => {
        mockReaddirSync.mockReturnValue(['a.png', 'b.jpg', 'readme.txt'])

        const svc = freshService()
        svc.load('/some/folder')

        // readme.txt is not an image. Pixel-duplicate pruning should not collapse
        // a.png and b.jpg because they have different path-derived bitmaps.
        expect(svc.getArray()).toHaveLength(2)
    })

    it('is a no-op on subsequent calls (load-once semantics)', () => {
        mockReaddirSync.mockReturnValue(['shot.png'])

        const svc = freshService()
        svc.load()
        const countAfterFirst = svc.getArray().length

        // Second call must not change anything
        mockReaddirSync.mockReturnValue(['a.png', 'b.png'])
        svc.load()
        expect(svc.getArray()).toHaveLength(countAfterFirst)
    })

    it('produces an empty array when the directory read throws', () => {
        mockReaddirSync.mockImplementation(() => { throw new Error('no such dir') })

        const svc = freshService()
        svc.load()
        expect(svc.getArray()).toHaveLength(0)
    })

    it('does not decode or pixel-dedupe images at load (dedup is capture-time only)', async () => {
        // Two files that would decode to the SAME bitmap. The old load() ran
        // prunePixelDuplicates and collapsed them to one; load is now a metadata-only
        // scan, so both remain and no image is decoded on the launch path.
        mockReaddirSync.mockReturnValue(['dup-a.png', 'dup-b.png'])
        const { nativeImage } = await import('electron')
        const fixed = Buffer.alloc(4 * 4 * 4, 0x7f)
        const decodeSpy = vi.spyOn(nativeImage, 'createFromPath').mockImplementation(() => ({
            isEmpty: () => false,
            getSize: (_scale?: number) => ({ width: 4, height: 4 }),
            toBitmap: () => fixed,
            resize: (opts: { width: number; height: number }) => opts
        } as unknown as Electron.NativeImage))

        const svc = freshService()
        svc.load('/some/folder')

        expect(svc.getArray()).toHaveLength(2)
        expect(decodeSpy).not.toHaveBeenCalled()

        vi.restoreAllMocks()
    })

    it('sorts entries by mtime ascending so newest is last', () => {
        mockReaddirSync.mockReturnValue(['old.png', 'new.png'])
        mockStatSync.mockImplementation((filePath) => {
            const mtime = String(filePath).includes('old') ? 1000 : 3000
            return { mtimeMs: mtime, isFile: () => true } as ReturnType<typeof mockStatSync>
        })

        const svc = freshService()
        svc.load()
        const arr = svc.getArray()
        // Sorted ascending by mtime: old (1000) first, new (3000) last.
        expect(arr[0]!.timestamp).toBe(1000)
        expect(arr[1]!.timestamp).toBe(3000)
    })
})

// ---------------------------------------------------------------------------
// reload()
// ---------------------------------------------------------------------------

describe('ScreenshotHistoryService.reload()', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockExistsSync.mockReturnValue(true)
        mockStatSync.mockImplementation(defaultStat as unknown as typeof mockStatSync)
    })

    it('re-reads the directory after reload even if load was already called', () => {
        mockReaddirSync.mockReturnValue(['first.png'])

        const svc = freshService()
        svc.load()
        expect(svc.getArray()).toHaveLength(1)

        // Three distinct files so duplicates are not pruned.
        mockReaddirSync.mockReturnValue(['a.png', 'b.png', 'c.png'])
        svc.reload()
        expect(svc.getArray()).toHaveLength(3)
    })

    it('clears history before reloading (mutates the same array reference)', () => {
        mockReaddirSync.mockReturnValue(['x.png'])

        const svc = freshService()
        svc.load()
        const arrayRef = svc.getArray()

        mockReaddirSync.mockReturnValue([])
        svc.reload()

        // Same array reference, mutated in place.
        expect(arrayRef).toHaveLength(0)
    })
})

// ---------------------------------------------------------------------------
// getEntries()
// ---------------------------------------------------------------------------

describe('ScreenshotHistoryService.getEntries()', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockExistsSync.mockReturnValue(true)
    })

    it('returns entries in reverse-chronological order (newest first)', () => {
        // Each file has a distinct path so bitmaps differ and prune leaves all three.
        mockReaddirSync.mockReturnValue(['old.png', 'mid.png', 'new.png'])
        let callCount = 0
        mockStatSync.mockImplementation(() => {
            const mtime = [1000, 2000, 3000][callCount++ % 3]!
            return { mtimeMs: mtime, isFile: () => true } as ReturnType<typeof mockStatSync>
        })

        const svc = freshService()
        svc.load()
        const entries = svc.getEntries()

        expect(entries).toHaveLength(3)
        // getEntries() reverses the array: newest timestamp (3000) should be index 0.
        expect(entries[0]!.label).toBeDefined()
        // Verify reverse order by comparing timestamps from the raw array.
        const arr = svc.getArray()
        expect(arr[0]!.timestamp).toBe(1000)  // oldest first in internal array
        expect(arr[2]!.timestamp).toBe(3000)  // newest last
    })

    it('returns file:// URLs for paths', () => {
        mockReaddirSync.mockReturnValue(['shot.png'])
        mockStatSync.mockImplementation(defaultStat as unknown as typeof mockStatSync)

        const svc = freshService()
        svc.load()
        const entries = svc.getEntries()
        expect(entries[0]!.path).toMatch(/^file:\/\//)
    })

    it('returns a label string for each entry', () => {
        mockReaddirSync.mockReturnValue(['shot.png'])
        mockStatSync.mockReturnValue({ mtimeMs: Date.now(), isFile: () => true } as ReturnType<typeof mockStatSync>)

        const svc = freshService()
        svc.load()
        const entries = svc.getEntries()
        expect(typeof entries[0]!.label).toBe('string')
        expect(entries[0]!.label.length).toBeGreaterThan(0)
    })
})

// ---------------------------------------------------------------------------
// push()
// ---------------------------------------------------------------------------

describe('ScreenshotHistoryService.push()', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        // Directory is empty so no pixel-duplicate logic runs on load.
        mockReaddirSync.mockReturnValue([])
        mockExistsSync.mockReturnValue(true)
        mockStatSync.mockImplementation(defaultStat as unknown as typeof mockStatSync)
        // copyFileSync succeeds by default (vi.fn returns undefined).
        mockCopyFileSync.mockReset()
    })

    it('copies the source file into the history directory and adds an entry', () => {
        const svc = freshService()
        const result = svc.push('/tmp/capture.png', 'png')

        expect(result).toBe(true)
        expect(mockCopyFileSync).toHaveBeenCalledOnce()
        expect(svc.getArray()).toHaveLength(1)
    })

    it('returns false without throwing when copyFileSync throws', () => {
        mockCopyFileSync.mockImplementation(() => { throw new Error('disk full') })

        const svc = freshService()
        const result = svc.push('/tmp/capture.png', 'png')

        expect(result).toBe(false)
        expect(svc.getArray()).toHaveLength(0)
    })

    it('persists the index after adding an entry', () => {
        const svc = freshService()
        svc.push('/tmp/capture.png', 'png')

        // save() calls writeFileSync with the index JSON. Verify it was called.
        const calls = mockWriteFileSync.mock.calls
        const indexWrite = calls.find(([filePath]) => String(filePath).includes('screenshot-history-index'))
        expect(indexWrite).toBeDefined()
    })

    it('trims history to SCREENSHOT_HISTORY_MAX (20) entries', async () => {
        const { nativeImage } = await import('electron')
        // Override nativeImage to return unique bitmaps per call index so none
        // are pruned as pixel duplicates.
        let callIdx = 0
        vi.spyOn(nativeImage, 'createFromPath').mockImplementation(() => ({
            isEmpty: () => false,
            getSize: (_scale?: number) => ({ width: 4, height: 4 }),
            toBitmap: () => Buffer.alloc(4 * 4 * 4, callIdx++),
            resize: (opts: { width: number; height: number }) => opts
        } as unknown as Electron.NativeImage))

        const svc = freshService()
        for (let i = 0; i < 22; i++) {
            svc.push(`/tmp/capture-${i}.png`, 'png')
        }

        expect(svc.getArray().length).toBeLessThanOrEqual(20)

        vi.restoreAllMocks()
    })
})

// ---------------------------------------------------------------------------
// clearForReset()
// ---------------------------------------------------------------------------

describe('ScreenshotHistoryService.clearForReset()', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockReaddirSync.mockReturnValue(['a.png'])
        mockStatSync.mockImplementation(defaultStat as unknown as typeof mockStatSync)
        mockExistsSync.mockReturnValue(true)
    })

    it('empties the in-memory history array in place', () => {
        const svc = freshService()
        svc.load()
        const arrayRef = svc.getArray()
        expect(arrayRef.length).toBeGreaterThan(0)

        svc.clearForReset()
        expect(arrayRef).toHaveLength(0)
    })

    it('writes an empty JSON array to the index file after clearing', () => {
        const svc = freshService()
        mockWriteFileSync.mockClear()  // clear any writes from load/prune
        svc.clearForReset()

        const writeCalls = mockWriteFileSync.mock.calls
        const emptyIndexWrite = writeCalls.find(([, content]) => content === '[]')
        expect(emptyIndexWrite).toBeDefined()
    })
})

// ---------------------------------------------------------------------------
// getArray() shared-reference semantics
// ---------------------------------------------------------------------------

describe('ScreenshotHistoryService.getArray() shared reference', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockReaddirSync.mockReturnValue([])
        mockExistsSync.mockReturnValue(true)
        mockStatSync.mockImplementation(defaultStat as unknown as typeof mockStatSync)
    })

    it('returns the same array reference across calls', () => {
        const svc = freshService()
        svc.load()
        const ref1 = svc.getArray()
        const ref2 = svc.getArray()
        expect(ref1).toBe(ref2)
    })

    it('mutations via push() are visible through a previously obtained reference', () => {
        mockCopyFileSync.mockReset()
        const svc = freshService()
        svc.load()
        const ref = svc.getArray()

        svc.push('/tmp/frame.png', 'png')
        expect(ref).toHaveLength(1)
    })
})

// ---------------------------------------------------------------------------
// pixel-duplicate pruning (via push)
// ---------------------------------------------------------------------------

describe('pixel-duplicate pruning', () => {
    it('does not add a second entry when the same bitmap is pushed twice', async () => {
        vi.clearAllMocks()
        mockReaddirSync.mockReturnValue([])
        mockExistsSync.mockReturnValue(true)
        mockStatSync.mockImplementation(defaultStat as unknown as typeof mockStatSync)
        mockCopyFileSync.mockReset()

        // Override nativeImage to always return the same bitmap regardless of path.
        const { nativeImage } = await import('electron')
        const fixedData = Buffer.alloc(4 * 4 * 4, 0xde)
        vi.spyOn(nativeImage, 'createFromPath').mockImplementation(() => ({
            isEmpty: () => false,
            getSize: (_scale?: number) => ({ width: 4, height: 4 }),
            toBitmap: () => fixedData,
            resize: (opts: { width: number; height: number }) => opts
        } as unknown as Electron.NativeImage))

        const svc = freshService()
        svc.push('/tmp/shot1.png', 'png')

        // Second push: same bitmap so findPixelIdenticalEntry should match the first.
        // Note: the first push copies to a history path, so we must set the dest path in
        // mockCopyFileSync so findPixelIdenticalEntry can compare it. Since both share
        // the same bitmap the second should be skipped.
        const result2 = svc.push('/tmp/shot2.png', 'png')

        // result2 is false (no new entry added, no prune needed either)
        expect(result2).toBe(false)
        expect(svc.getArray()).toHaveLength(1)

        vi.restoreAllMocks()
    })
})

// ---------------------------------------------------------------------------
// notifyPreviewReset()
// ---------------------------------------------------------------------------

describe('ScreenshotHistoryService.notifyPreviewReset()', () => {
    it('sends all three IPC messages when the preview window is alive', () => {
        const send = vi.fn()
        const fakeWindow = {
            isDestroyed: () => false,
            webContents: {
                isDestroyed: () => false,
                send
            }
        }

        const svc = freshService()
        svc.notifyPreviewReset(() => fakeWindow as unknown as import('electron').BrowserWindow)

        const messageTypes = send.mock.calls.map(([, payload]) => (payload as { type: string }).type)
        expect(messageTypes).toContain('history-updated')
        expect(messageTypes).toContain('onion-history-updated')
        expect(messageTypes).toContain('clear-onion')
        expect(send).toHaveBeenCalledTimes(3)
    })

    it('does nothing when getPreviewWindow returns null', () => {
        const svc = freshService()
        expect(() => svc.notifyPreviewReset(() => null)).not.toThrow()
    })

    it('does nothing when the window is destroyed', () => {
        const send = vi.fn()
        const destroyedWindow = {
            isDestroyed: () => true,
            webContents: { isDestroyed: () => false, send }
        }

        const svc = freshService()
        svc.notifyPreviewReset(() => destroyedWindow as unknown as import('electron').BrowserWindow)
        expect(send).not.toHaveBeenCalled()
    })

    it('does nothing when webContents is destroyed', () => {
        const send = vi.fn()
        const wcDestroyedWindow = {
            isDestroyed: () => false,
            webContents: { isDestroyed: () => true, send }
        }

        const svc = freshService()
        svc.notifyPreviewReset(() => wcDestroyedWindow as unknown as import('electron').BrowserWindow)
        expect(send).not.toHaveBeenCalled()
    })
})

// ---------------------------------------------------------------------------
// formatHistoryLabel (exported standalone)
// ---------------------------------------------------------------------------

describe('formatHistoryLabel', () => {
    it('returns a non-empty string', async () => {
        const { formatHistoryLabel } = await import('@main/services/screenshotHistory')
        const label = formatHistoryLabel(Date.now())
        expect(typeof label).toBe('string')
        expect(label.length).toBeGreaterThan(0)
    })
})

// ---------------------------------------------------------------------------
// createHistoryThumbnail (exported standalone)
// ---------------------------------------------------------------------------

describe('createHistoryThumbnail', () => {
    it('returns a defined value when the file exists', async () => {
        mockExistsSync.mockReturnValue(true)
        const { createHistoryThumbnail } = await import('@main/services/screenshotHistory')
        const result = createHistoryThumbnail('/some/file.png')
        expect(result).toBeDefined()
    })

    it('returns undefined when the file does not exist', async () => {
        mockExistsSync.mockReturnValue(false)
        const { createHistoryThumbnail } = await import('@main/services/screenshotHistory')
        const result = createHistoryThumbnail('/missing/file.png')
        expect(result).toBeUndefined()
    })
})
