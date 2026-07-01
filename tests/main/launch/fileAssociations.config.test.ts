/**
 * Guards the electron-builder fileAssociations so the associated set and macOS
 * ranks cannot silently regress. Reads the JSON config directly (no electron).
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const config = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../../electron-builder.json'), 'utf-8')
) as { fileAssociations?: Array<{ ext: string; rank?: string; role?: string }> }

describe('electron-builder fileAssociations', () => {
    const byExt = new Map((config.fileAssociations ?? []).map(assoc => [assoc.ext, assoc]))

    it('associates exactly json, svg, rasp, rscript', () => {
        expect([...byExt.keys()].sort()).toEqual(['json', 'rasp', 'rscript', 'svg'])
    })

    it('owns the RokDock-native types and is alternate for shared types (macOS rank)', () => {
        expect(byExt.get('rscript')?.rank).toBe('Owner')
        expect(byExt.get('rasp')?.rank).toBe('Owner')
        expect(byExt.get('json')?.rank).toBe('Alternate')
        expect(byExt.get('svg')?.rank).toBe('Alternate')
    })

    it('does not associate generic png or the compound rscript.json', () => {
        expect(byExt.has('png')).toBe(false)
        expect(byExt.has('9.png')).toBe(false)
        expect(byExt.has('rscript.json')).toBe(false)
    })
})
