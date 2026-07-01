import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { safeStorage } from 'electron'
import { AiProfileStore } from '@main/services/ai/aiProfileStore'
import type { AppPreferences } from '@shared/types'

// Mock electron safeStorage with a reversible base64 "encryption".
vi.mock('electron', () => ({
    safeStorage: {
        isEncryptionAvailable: vi.fn(() => true),
        encryptString: (str: string) => Buffer.from(`enc:${str}`),
        decryptString: (buf: Buffer) => buf.toString().replace(/^enc:/, ''),
    },
}))

/** Minimal in-memory StoreService stand-in exposing only what AiProfileStore uses. */
function fakeStore() {
    let prefs = { aiProfiles: [], aiActiveProfileId: null, aiCliOverrides: {} } as unknown as AppPreferences
    return {
        getPreferences: () => prefs,
        setPreferences: (patch: Partial<AppPreferences>) => { prefs = { ...prefs, ...patch } },
    }
}

function tmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'ai-secrets-'))
}

describe('AiProfileStore', () => {
    let store: ReturnType<typeof fakeStore>
    let dir: string
    beforeEach(() => { store = fakeStore(); dir = tmpDir() })

    it('saves a profile, assigns an id, and reports hasKey from the secret presence', () => {
        const ps = new AiProfileStore(store as never, dir)
        const saved = ps.saveProfile({ name: 'Claude', adapter: 'anthropic', model: 'claude-opus-4-8', isLocal: false, redactionEnabled: true, key: 'sk-1' })
        expect(saved.id).toBeTruthy()
        expect(saved.hasKey).toBe(true)
        expect(ps.getKey(saved.id)).toBe('sk-1')
        // The stored profile never carries the key.
        expect((store.getPreferences().aiProfiles[0] as Record<string, unknown>).key).toBeUndefined()
    })

    it('keeps the existing key when an update omits key, and clears it on empty string', () => {
        const ps = new AiProfileStore(store as never, dir)
        const saved = ps.saveProfile({ name: 'C', adapter: 'anthropic', model: 'm', isLocal: false, redactionEnabled: true, key: 'sk-1' })
        ps.saveProfile({ id: saved.id, name: 'C2', adapter: 'anthropic', model: 'm', isLocal: false, redactionEnabled: true })
        expect(ps.getKey(saved.id)).toBe('sk-1')
        expect(ps.getProfile(saved.id)?.name).toBe('C2')
        ps.saveProfile({ id: saved.id, name: 'C2', adapter: 'anthropic', model: 'm', isLocal: false, redactionEnabled: true, key: '' })
        expect(ps.getKey(saved.id)).toBeUndefined()
        expect(ps.getProfile(saved.id)?.hasKey).toBe(false)
    })

    it('deletes a profile and its key, and clears the active id if it pointed at it', () => {
        const ps = new AiProfileStore(store as never, dir)
        // Use a non-CLI adapter so the profile is not filtered out before deletion.
        const saved = ps.saveProfile({ name: 'C', adapter: 'anthropic', model: 'm', isLocal: true, redactionEnabled: false })
        ps.setActiveId(saved.id)
        ps.deleteProfile(saved.id)
        expect(ps.listProfiles()).toHaveLength(0)
        expect(ps.getActiveId()).toBeNull()
    })

    it('filters out legacy adapter:cli profiles from listProfiles', () => {
        const ps = new AiProfileStore(store as never, dir)
        // A profile saved with adapter:'cli' was written by old code (pre-detection-only).
        // It has no cliKind and would throw at send time, so listProfiles silently excludes it.
        const saved = ps.saveProfile({ name: 'OldCli', adapter: 'cli', model: 'm', isLocal: true, redactionEnabled: false })
        expect(ps.listProfiles()).toHaveLength(0)
        // The record is on disk and can still be deleted (deleteProfile reads the raw store).
        ps.deleteProfile(saved.id)
        expect(ps.listProfiles()).toHaveLength(0)
    })

    it('persists keys to ai-secrets.json under the given dir', () => {
        const ps = new AiProfileStore(store as never, dir)
        ps.saveProfile({ name: 'C', adapter: 'anthropic', model: 'm', isLocal: false, redactionEnabled: true, key: 'sk-2' })
        const file = path.join(dir, 'ai-secrets.json')
        expect(fs.existsSync(file)).toBe(true)
        expect(fs.readFileSync(file, 'utf-8')).not.toContain('sk-2') // stored encrypted, not plaintext
    })

    it('clearSecrets deletes the secrets file so a reset drops every saved key', () => {
        const ps = new AiProfileStore(store as never, dir)
        ps.saveProfile({ name: 'A', adapter: 'anthropic', model: 'm', isLocal: false, redactionEnabled: true, key: 'sk-a' })
        ps.saveProfile({ name: 'B', adapter: 'gemini', model: 'm', isLocal: false, redactionEnabled: true, key: 'sk-b' })
        const file = path.join(dir, 'ai-secrets.json')
        expect(fs.existsSync(file)).toBe(true)

        ps.clearSecrets()
        expect(fs.existsSync(file)).toBe(false)
        // No keys survive: getKey reads the (now absent) file and returns undefined.
        expect(ps.listProfiles().every(profile => !profile.hasKey)).toBe(true)
    })

    it('clearSecrets is a no-op when no secrets file exists', () => {
        const ps = new AiProfileStore(store as never, dir)
        expect(() => ps.clearSecrets()).not.toThrow()
    })

    it('throws when safeStorage is unavailable and a non-empty key is provided', () => {
        vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValueOnce(false)
        const ps = new AiProfileStore(store as never, dir)
        expect(() =>
            ps.saveProfile({ name: 'C', adapter: 'anthropic', model: 'm', isLocal: false, redactionEnabled: true, key: 'sk-3' })
        ).toThrow(/secure key storage|not available/i)
    })
})

describe('AiProfileStore CLI overrides', () => {
    it('round-trips a per-CLI override', () => {
        const store = fakeStore()
        // The secrets dir is unused by the override methods, but pass a real temp path (Windows-safe).
        const profileStore = new AiProfileStore(store as never, tmpDir())
        expect(profileStore.getCliOverrides()).toEqual({})
        profileStore.setCliOverride('claude', { model: 'claude-opus-4-8', hidden: false })
        expect(profileStore.getCliOverrides().claude).toEqual({ model: 'claude-opus-4-8', hidden: false })
        profileStore.setCliOverride('codex', { redactionEnabled: false })
        expect(Object.keys(profileStore.getCliOverrides()).sort()).toEqual(['claude', 'codex'])
    })
})
