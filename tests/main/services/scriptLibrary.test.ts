/**
 * Unit tests for ScriptLibrary's dual-extension behavior. Electron's app.getPath is
 * mocked to a real temp dir so the actual fs operations (write, list, unlink) run.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const { userDataDir } = vi.hoisted(() => {
    const nodeFs = require('fs') as typeof import('fs')
    const nodeOs = require('os') as typeof import('os')
    const nodePath = require('path') as typeof import('path')
    return { userDataDir: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'rokdock-lib-')) }
})

vi.mock('electron', () => ({ app: { getPath: () => userDataDir } }))

import { ScriptLibrary } from '@main/services/scriptLibrary'
import type { ScriptFile } from '@shared/script'

const scriptsDir = path.join(userDataDir, 'scripts')

function makeScript(name: string, steps = 0): ScriptFile {
    return { version: 1, name, raspMode: true, metadata: {}, steps: Array.from({ length: steps }, () => ({ type: 'delay', durationMs: 1 })) } as ScriptFile
}

describe('ScriptLibrary dual extension', () => {
    let lib: ScriptLibrary

    beforeEach(() => {
        fs.rmSync(scriptsDir, { recursive: true, force: true })
        lib = new ScriptLibrary()
        lib.init()
    })

    afterAll(() => {
        fs.rmSync(userDataDir, { recursive: true, force: true })
    })

    it('saves with the new .rscript extension', () => {
        const filePath = lib.save(makeScript('demo'))
        expect(filePath.endsWith('.rscript')).toBe(true)
        expect(filePath.endsWith('.rscript.json')).toBe(false)
        expect(fs.existsSync(filePath)).toBe(true)
    })

    it('lists both legacy .rscript.json and new .rscript files with correct names', () => {
        fs.writeFileSync(path.join(scriptsDir, 'old.rscript.json'), JSON.stringify(makeScript('old', 2)), 'utf-8')
        fs.writeFileSync(path.join(scriptsDir, 'new.rscript'), JSON.stringify(makeScript('new', 3)), 'utf-8')
        const names = lib.list().map(e => e.name).sort()
        expect(names).toEqual(['new', 'old'])
        const old = lib.list().find(e => e.name === 'old')!
        expect(old.stepCount).toBe(2)
    })

    it('upgrades a legacy file in place on save (no duplicate entry)', () => {
        fs.writeFileSync(path.join(scriptsDir, 'demo.rscript.json'), JSON.stringify(makeScript('demo', 1)), 'utf-8')
        lib.save(makeScript('demo', 5))
        expect(fs.existsSync(path.join(scriptsDir, 'demo.rscript.json'))).toBe(false)
        expect(fs.existsSync(path.join(scriptsDir, 'demo.rscript'))).toBe(true)
        const entries = lib.list().filter(e => e.name === 'demo')
        expect(entries).toHaveLength(1)
        expect(entries[0].stepCount).toBe(5)
    })

    it('deletes both extensions in deleteAll', () => {
        fs.writeFileSync(path.join(scriptsDir, 'a.rscript.json'), JSON.stringify(makeScript('a')), 'utf-8')
        fs.writeFileSync(path.join(scriptsDir, 'b.rscript'), JSON.stringify(makeScript('b')), 'utf-8')
        lib.deleteAll()
        expect(lib.list()).toEqual([])
    })

    it('keeps a script in its sort-order position when a legacy file is upgraded on save', () => {
        const aLegacy = path.join(scriptsDir, 'a.rscript.json')
        const bPath = path.join(scriptsDir, 'b.rscript')
        fs.writeFileSync(aLegacy, JSON.stringify(makeScript('a')), 'utf-8')
        fs.writeFileSync(bPath, JSON.stringify(makeScript('b')), 'utf-8')
        lib.saveSortOrder([aLegacy, bPath])
        // Re-saving 'a' upgrades a.rscript.json to a.rscript. Its sort-order entry
        // must follow the rename so 'a' stays ahead of 'b'.
        lib.save(makeScript('a', 2))
        expect(lib.list().map(e => e.name)).toEqual(['a', 'b'])
    })
})
