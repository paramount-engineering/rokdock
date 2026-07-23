import os from 'os'
import path from 'path'
import { describe, it, expect } from 'vitest'
import { parseLaunchRequest, toolForFile } from '@main/launch/launchRequest'

describe('parseLaunchRequest', () => {
    const cwd = '/work'

    it('returns null for a bare launch (no --tool)', () => {
        expect(parseLaunchRequest(['/path/electron', 'out/main/main.js'], cwd)).toBeNull()
    })

    it('parses --tool with a space-separated value', () => {
        expect(parseLaunchRequest(['electron', 'main.js', '--tool', 'json'], cwd))
            .toEqual({ tool: 'json' })
    })

    it('parses --tool=value form', () => {
        expect(parseLaunchRequest(['electron', 'main.js', '--tool=svg'], cwd))
            .toEqual({ tool: 'svg' })
    })

    // Electron reorders the argv it forwards to the second-instance handler: bare
    // positionals are moved to the end and its own switches are spliced in. The
    // attached --tool=<key> form survives that intact, which is why the launchers
    // use it. This is the exact shape observed from a `RokDock --tool=json` relaunch.
    it('parses --tool=value from a reordered second-instance argv', () => {
        const reordered = ['electron', '--user-data-dir=/d', '--no-sandbox', '--tool=json', '--allow-file-access-from-files', 'out/main/main.js']
        expect(parseLaunchRequest(reordered, cwd)).toEqual({ tool: 'json' })
    })

    // The space-separated form does NOT survive that reordering: a switch lands
    // between --tool and its value, so the value is lost. This is the failure the
    // launcher --tool=<key> form exists to avoid; documented so it does not regress.
    it('returns null when a reordered argv separates --tool from its space value', () => {
        const reordered = ['electron', '--user-data-dir=/d', '--tool', '--allow-file-access-from-files', 'out/main/main.js', 'json']
        expect(parseLaunchRequest(reordered, cwd)).toBeNull()
    })

    it('parses a following absolute file path', () => {
        expect(parseLaunchRequest(['electron', 'main.js', '--tool', 'json', '/abs/foo.json'], cwd))
            .toEqual({ tool: 'json', filePath: '/abs/foo.json' })
    })

    it('resolves a relative file path against cwd', () => {
        const base = os.tmpdir()
        expect(parseLaunchRequest(['electron', 'main.js', '--tool', 'svg', 'a/b.svg'], base))
            .toEqual({ tool: 'svg', filePath: path.resolve(base, 'a/b.svg') })
    })

    it('accepts all four tool keys', () => {
        for (const tool of ['json', 'svg', 'ninepatch', 'script'] as const) {
            expect(parseLaunchRequest(['e', 'm', '--tool', tool], cwd)).toEqual({ tool })
        }
    })

    it('returns null for an unknown tool key (forgiving fallback to dock)', () => {
        expect(parseLaunchRequest(['e', 'm', '--tool', 'bogus'], cwd)).toBeNull()
    })

    it('returns null when --tool has no value', () => {
        expect(parseLaunchRequest(['e', 'm', '--tool'], cwd)).toBeNull()
    })

    it('ignores a following flag as the file path', () => {
        expect(parseLaunchRequest(['e', 'm', '--tool', 'json', '--no-sandbox'], cwd))
            .toEqual({ tool: 'json' })
    })

    it('tolerates leading electron argv entries (token scan, not fixed index)', () => {
        const base = os.tmpdir()
        expect(parseLaunchRequest(['/usr/bin/electron', '--inspect', 'out/main/main.js', '--tool', 'ninepatch', 'x.9.png'], base))
            .toEqual({ tool: 'ninepatch', filePath: path.resolve(base, 'x.9.png') })
    })
})

describe('toolForFile', () => {
    it('maps each associated extension to its tool', () => {
        expect(toolForFile('/a/b.json')).toBe('json')
        expect(toolForFile('/a/b.svg')).toBe('svg')
        expect(toolForFile('/a/b.rasp')).toBe('script')
        expect(toolForFile('/a/b.rscript')).toBe('script')
    })

    it('is case-insensitive', () => {
        expect(toolForFile('/a/B.SVG')).toBe('svg')
        expect(toolForFile('/a/B.RScript')).toBe('script')
    })

    it('routes a legacy .rscript.json to the JSON editor (intended fallback)', () => {
        expect(toolForFile('/a/demo.rscript.json')).toBe('json')
    })

    it('returns null for unowned extensions (including png/9.png)', () => {
        expect(toolForFile('/a/b.png')).toBeNull()
        expect(toolForFile('/a/b.9.png')).toBeNull()
        expect(toolForFile('/a/b.txt')).toBeNull()
        expect(toolForFile('/a/b')).toBeNull()
    })
})

describe('parseLaunchRequest bare-path fallback', () => {
    it('maps a bare absolute file path with a known extension', () => {
        expect(parseLaunchRequest(['electron', 'main.js', '/abs/foo.svg'], '/work'))
            .toEqual({ tool: 'svg', filePath: '/abs/foo.svg' })
    })

    it('resolves a bare relative file path against cwd', () => {
        const base = os.tmpdir()
        expect(parseLaunchRequest(['electron', 'main.js', 'sub/foo.rscript'], base))
            .toEqual({ tool: 'script', filePath: path.resolve(base, 'sub/foo.rscript') })
    })

    it('skips flags before and after the file path', () => {
        expect(parseLaunchRequest(['out/main/main.js', '--user-data-dir=/tmp/x', '/abs/foo.json', '--no-sandbox'], '/work'))
            .toEqual({ tool: 'json', filePath: '/abs/foo.json' })
    })

    it('returns the first recognized file when several are present', () => {
        expect(parseLaunchRequest(['electron', 'main.js', '/abs/a.svg', '/abs/b.json'], '/work'))
            .toEqual({ tool: 'svg', filePath: '/abs/a.svg' })
    })

    it('returns null for a bare launch with no recognized file', () => {
        expect(parseLaunchRequest(['/path/electron', 'out/main/main.js'], '/work')).toBeNull()
    })

    it('lets an explicit --tool win and still attaches its path', () => {
        expect(parseLaunchRequest(['m', '--tool', 'svg', '/abs/foo.json'], '/work'))
            .toEqual({ tool: 'svg', filePath: '/abs/foo.json' })
    })

    it('falls back to the dock for an invalid --tool key even when a recognized file follows', () => {
        // An explicit --tool with an unknown key keeps the documented dock fallback.
        // It must not bare-path-scan the stray file argument into the JSON editor.
        expect(parseLaunchRequest(['m', '--tool', 'bogus', '/abs/foo.json'], '/work')).toBeNull()
    })
})
