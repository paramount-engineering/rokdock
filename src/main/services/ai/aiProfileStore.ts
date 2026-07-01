/**
 * Owns AI profile persistence. Non-secret profile metadata lives in AppPreferences
 * (via StoreService); API keys are encrypted with Electron safeStorage and held in a
 * separate ai-secrets.json (outside rokdock-config.json), keyed by profile id. The
 * renderer only ever learns hasKey, never the key.
 */
import path from 'path'
import fs from 'fs'
import { safeStorage } from 'electron'
import { isEncrypted, encryptToField, decryptField } from '../../utils/encryptedField'
import type { StoreService } from '../store'
import type { AiProfile, AiProfileInput, StoredAiProfile, AiCliOverrides, CliOverride } from '../../../shared/ai/types'
import type { CliKind } from '../../../ai-core/types'

const SECRETS_FILE = 'ai-secrets.json'

export class AiProfileStore {
    constructor(private store: StoreService, private secretsDir: string) {}

    private secretsPath(): string {
        return path.join(this.secretsDir, SECRETS_FILE)
    }

    private readSecrets(): Record<string, string> {
        try {
            return JSON.parse(fs.readFileSync(this.secretsPath(), 'utf-8')) as Record<string, string>
        } catch {
            return {}
        }
    }

    private writeSecrets(secrets: Record<string, string>): void {
        try {
            fs.mkdirSync(this.secretsDir, { recursive: true })
            const file = this.secretsPath()
            // 0o600 keeps the encrypted secrets file owner-only. This matters most on Linux,
            // where safeStorage can fall back to a weak backend, so file mode is the real barrier.
            // writeFileSync mode applies only on create, so chmod an already-existing file too.
            fs.writeFileSync(file, JSON.stringify(secrets), { encoding: 'utf-8', mode: 0o600 })
            try { fs.chmodSync(file, 0o600) } catch { /* chmod is a no-op on Windows; best-effort */ }
        } catch { /* best-effort. A key that cannot be written surfaces later as a missing-key error */ }
    }

    private encrypt(value: string): string {
        if (!safeStorage.isEncryptionAvailable()) {
            throw new Error('Secure key storage is not available on this system. Cannot store an API key.')
        }
        return encryptToField(value)
    }

    private toProfile(stored: StoredAiProfile, secrets: Record<string, string>): AiProfile {
        // A key counts as present only when it is a well-formed encrypted value. There is no
        // legacy-plaintext path here (unlike store.ts): encrypt() always writes the prefix, so
        // an unprefixed value can only arrive via tampering or a hand-edited file and is rejected.
        return { ...stored, hasKey: Boolean(secrets[stored.id] && isEncrypted(secrets[stored.id])) }
    }

    listProfiles(): AiProfile[] {
        const secrets = this.readSecrets()
        // CLI providers are now detection-only (synthetic ids of the form cli:<kind>). A stored
        // profile whose adapter is 'cli' was saved by old code before this change and has no
        // cliKind, so it would throw "CLI provider is missing its CLI kind" at send time. Filter
        // such entries out gracefully; the stored record stays on disk but is never surfaced.
        return (this.store.getPreferences().aiProfiles ?? [])
            .filter(profile => profile.adapter !== 'cli')
            .map(profile => this.toProfile(profile, secrets))
    }

    getProfile(id: string): AiProfile | undefined {
        return this.listProfiles().find(profile => profile.id === id)
    }

    saveProfile(input: AiProfileInput): AiProfile {
        const id = input.id ?? crypto.randomUUID()
        const stored: StoredAiProfile = {
            id,
            name: input.name,
            adapter: input.adapter,
            model: input.model,
            baseUrl: input.baseUrl,
            isLocal: input.isLocal,
            redactionEnabled: input.redactionEnabled,
        }
        const profiles: StoredAiProfile[] = (this.store.getPreferences().aiProfiles ?? []).filter(profile => profile.id !== id)
        profiles.push(stored)
        this.store.setPreferences({ aiProfiles: profiles })

        // key undefined -> leave as-is; '' -> clear; otherwise -> set.
        let hasKey: boolean
        if (input.key !== undefined) {
            const secrets = this.readSecrets()
            if (input.key === '') { delete secrets[id]; hasKey = false }
            else { secrets[id] = this.encrypt(input.key); hasKey = true }
            this.writeSecrets(secrets)
        } else {
            hasKey = Boolean(this.readSecrets()[id])
        }
        return { ...stored, hasKey }
    }

    /**
     * Deletes the entire encrypted secrets file. The non-secret profile metadata
     * lives in AppPreferences and is cleared separately by the store reset, so this
     * is the piece a config reset needs to also drop the saved API keys rather than
     * leave them orphaned on disk. Best-effort: a missing file is already clean.
     */
    clearSecrets(): void {
        try { fs.rmSync(this.secretsPath(), { recursive: true, force: true }) } catch { /* best-effort: already gone or unwritable */ }
    }

    deleteProfile(id: string): void {
        const profiles = (this.store.getPreferences().aiProfiles ?? []).filter(profile => profile.id !== id)
        const activeId = this.store.getPreferences().aiActiveProfileId
        this.store.setPreferences({
            aiProfiles: profiles,
            ...(activeId === id ? { aiActiveProfileId: null } : {}),
        })
        const secrets = this.readSecrets()
        if (secrets[id]) { delete secrets[id]; this.writeSecrets(secrets) }
    }

    getActiveId(): string | null {
        return this.store.getPreferences().aiActiveProfileId ?? null
    }

    setActiveId(id: string | null): void {
        this.store.setPreferences({ aiActiveProfileId: id })
    }

    getKey(id: string): string | undefined {
        // decryptField rejects unprefixed values, so a tampered or hand-edited secret returns undefined.
        return decryptField(this.readSecrets()[id] ?? '')
    }

    getCliOverrides(): AiCliOverrides {
        return this.store.getPreferences().aiCliOverrides ?? {}
    }

    setCliOverride(kind: CliKind, override: CliOverride): void {
        const overrides = { ...this.getCliOverrides(), [kind]: override }
        this.store.setPreferences({ aiCliOverrides: overrides })
    }
}
