/**
 * Unit tests for JsonSessionStore. Electron's app.getPath is mocked to a real temp
 * dir so the actual fs operations run.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const { userDataDir } = vi.hoisted(() => {
    const nodeFs = require('fs') as typeof import('fs')
    const nodeOs = require('os') as typeof import('os')
    const nodePath = require('path') as typeof import('path')
    return { userDataDir: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'rokdock-jsonsess-')) }
})

vi.mock('electron', () => ({ app: { getPath: () => userDataDir } }))

import { JsonSessionStore } from '@main/services/jsonSessionStore'
import type { JsonSessionSnapshot } from '@shared/jsonSession'

const sessionDir = path.join(userDataDir, 'json-editor-session')

function reset() { fs.rmSync(sessionDir, { recursive: true, force: true }) }

describe('JsonSessionStore', () => {
    let store: JsonSessionStore
    beforeEach(() => { reset(); store = new JsonSessionStore() })
    afterAll(() => { fs.rmSync(userDataDir, { recursive: true, force: true }) })

    it('returns null when no session exists', () => {
        expect(store.loadRestoredSession()).toBeNull()
    })

    it('writes a draft for a dirty/untitled buffer and restores its content', () => {
        const snap: JsonSessionSnapshot = {
            activeBufferId: 'a',
            buffers: [{ id: 'a', title: 'untitled-1', filePath: null, dirty: true, content: '{"x":1}' }],
        }
        store.writeSession(snap)
        const restored = store.loadRestoredSession()!
        expect(restored.activeBufferId).toBe('a')
        expect(restored.buffers).toHaveLength(1)
        expect(restored.buffers[0]).toMatchObject({ id: 'a', title: 'untitled-1', filePath: null, dirty: true, content: '{"x":1}' })
        expect(restored.missing).toEqual([])
    })

    it('reloads a clean file-backed buffer from disk (no draft written)', () => {
        const filePath = path.join(userDataDir, 'demo.json')
        fs.writeFileSync(filePath, '{"disk":true}', 'utf-8')
        store.writeSession({ activeBufferId: 'b', buffers: [{ id: 'b', title: 'demo.json', filePath, dirty: false, content: null }] })
        // No draft file for a clean buffer.
        expect(fs.existsSync(path.join(sessionDir, 'b.txt'))).toBe(false)
        const restored = store.loadRestoredSession()!
        expect(restored.buffers[0].content).toBe('{"disk":true}')
    })

    it('reports a clean buffer whose file is gone in missing[], not in buffers', () => {
        store.writeSession({ activeBufferId: 'c', buffers: [{ id: 'c', title: 'gone.json', filePath: '/no/such/gone.json', dirty: false, content: null }] })
        const restored = store.loadRestoredSession()!
        expect(restored.buffers).toHaveLength(0)
        expect(restored.missing).toEqual(['/no/such/gone.json'])
    })

    it('reconciles: a draft whose buffer is now clean or absent is deleted', () => {
        store.writeSession({ activeBufferId: 'a', buffers: [{ id: 'a', title: 't', filePath: null, dirty: true, content: 'draft' }] })
        expect(fs.existsSync(path.join(sessionDir, 'a.txt'))).toBe(true)
        // Re-save with 'a' now clean and a new absent buffer omitted entirely.
        store.writeSession({ activeBufferId: 'a', buffers: [{ id: 'a', title: 't', filePath: path.join(userDataDir, 'a.json'), dirty: false, content: null }] })
        expect(fs.existsSync(path.join(sessionDir, 'a.txt'))).toBe(false)
    })

    it('returns null for a corrupt manifest', () => {
        fs.mkdirSync(sessionDir, { recursive: true })
        fs.writeFileSync(path.join(sessionDir, 'session.json'), 'not json', 'utf-8')
        expect(store.loadRestoredSession()).toBeNull()
    })
})
