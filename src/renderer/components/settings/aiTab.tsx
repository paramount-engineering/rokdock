/**
 * AI Settings tab: manage provider profiles (one active), and a Test Connection
 * that streams a canned prompt through the real engine path while showing the
 * redaction preview. The tab never sees a key after it is saved (only hasKey);
 * it sends a key once on save. This is the proof-of-life surface for the engine seam.
 */
import React, { useCallback, useEffect, useState } from 'react'
import type { AiProfile, AiProfileInput, AiAdapterType, CliKind } from '../../../shared/ai/types'
import type { AppPreferences } from '../../../shared/types'
import { CLI_DEFINITIONS, CLI_KINDS } from '../../../ai-core/adapters/cliRegistry'
import { RokdockSelect, RokdockToggle, CollapsibleSettingsSection } from '../rokdock/wrappers'
import { roBot } from '../ai/roBotMark'
import ConfirmDialog from '../common/confirmDialog'
import IconButton from '../common/iconButton'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faSpinner, faPen, faTrash, faPlus } from '@fortawesome/free-solid-svg-icons'

/**
 * Provider-type dropdown options: the HTTP adapters, plus each recognized CLI. A CLI option's
 * value is `cli:<kind>`; selecting it configures that CLI (model + redaction) rather than an HTTP
 * profile, so a CLI that is not on PATH can still be added the same way any provider is.
 */
const PROVIDER_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
    { value: 'anthropic', label: 'Anthropic (Claude)' },
    { value: 'gemini', label: 'Gemini' },
    { value: 'openai-compatible', label: 'OpenAI-compatible' },
    ...CLI_KINDS.map(kind => ({ value: `cli:${kind}`, label: `${CLI_DEFINITIONS[kind].label} (CLI)` })),
]

/**
 * Per-adapter example model, shown as the field placeholder. No adapter prefills a
 * model value (no provider is favored); the user always supplies it. Switching the
 * adapter clears the model so a stale value from another provider is not carried over.
 */
const MODEL_PLACEHOLDER: Record<AiAdapterType, string> = {
    anthropic: 'e.g., claude-opus-4-8',
    gemini: 'e.g., gemini-2.5-flash',
    'openai-compatible': 'e.g., gpt-4o, or a local model like llama3.1',
    cli: '',
}

const BLANK: AiProfileInput = {
    name: '',
    adapter: 'anthropic',
    model: '',
    baseUrl: '',
    isLocal: false,
    redactionEnabled: true,
    key: '',
}

const FIELD_STYLE: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 }

// The provider list is one bordered container; rows are divided by hairlines (not floating
// cards), so it reads as a single list.
const PROFILE_LIST_STYLE: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    border: '1px solid var(--rokdock-border)',
    borderRadius: 'var(--rokdock-radius-sm)',
    overflow: 'hidden',
    background: 'var(--rokdock-bg-subtle)',
}

const ROW_STYLE: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
}

// Applied to every row after the first, so consecutive rows are separated by a hairline.
const ROW_DIVIDER_STYLE: React.CSSProperties = {
    borderTop: '1px solid var(--rokdock-border)',
}

// Fixed-width, right-aligned slot for the Active badge / Set active button. Holding it to a
// constant width lines up the Test, edit, and remove controls into columns across every row.
const ACTIVE_SLOT_STYLE: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'flex-end',
    flexShrink: 0,
    minWidth: 80,
}

const PROFILE_LABEL_STYLE: React.CSSProperties = {
    flex: 1,
    fontSize: 'var(--rokdock-font-sm)',
    color: 'var(--rokdock-text)',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
}

const ACTIVE_BADGE_STYLE: React.CSSProperties = {
    padding: '2px 8px',
    fontSize: 'var(--rokdock-font-xs, 11px)',
    fontWeight: 600,
    borderRadius: 'var(--rokdock-radius-sm)',
    background: 'var(--rokdock-brand-primary)',
    color: 'var(--rokdock-btn-text)',
}

const ROW_BTN_STYLE: React.CSSProperties = {
    padding: '2px 8px',
    fontSize: 'var(--rokdock-font-sm)',
}

/** Build the "what was sent" note for a completed test. Only call out redaction when it actually
 *  removed something. A clean prompt (nothing removed, or redaction off) shows no parenthetical. */
function formatRedactionNote(redactedCount: number, redacted: string): string {
    const removed = redactedCount > 0
        ? ` (${redactedCount} sensitive value${redactedCount === 1 ? '' : 's'} removed)`
        : ''
    return `Sent to the provider${removed}: ${redacted}`
}

const EMPTY_STYLE: React.CSSProperties = {
    fontSize: 'var(--rokdock-font-sm)',
    color: 'var(--rokdock-text-dim)',
    padding: '8px 12px',
}

const TEST_OUTPUT_STYLE: React.CSSProperties = {
    fontFamily: 'var(--rokdock-font-mono, monospace)',
    fontSize: 'var(--rokdock-font-sm)',
    background: 'var(--rokdock-bg-subtle)',
    border: '1px solid var(--rokdock-border)',
    borderRadius: 'var(--rokdock-radius-sm)',
    padding: '8px 10px',
    minHeight: 36,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    color: 'var(--rokdock-text)',
    marginTop: 4,
}

const REDACTION_PREVIEW_STYLE: React.CSSProperties = {
    fontSize: 'var(--rokdock-font-xs, 11px)',
    color: 'var(--rokdock-text-dim)',
    marginTop: 2,
    minHeight: 16,
}

const TOGGLE_FIELD_STYLE: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 }

const TOGGLE_ROW_STYLE: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 }

const REDACT_EXAMPLE_STYLE: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    marginTop: 4,
    padding: '8px 10px',
    background: 'var(--rokdock-bg-subtle)',
    border: '1px solid var(--rokdock-border)',
    borderRadius: 'var(--rokdock-radius-sm)',
}

const REDACT_ROW_STYLE: React.CSSProperties = { display: 'flex', alignItems: 'baseline', gap: 8 }

const REDACT_TAG_STYLE: React.CSSProperties = {
    flexShrink: 0,
    width: 42,
    fontSize: 'var(--rokdock-font-xs, 11px)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: 'var(--rokdock-text-dim)',
}

const REDACT_CODE_STYLE: React.CSSProperties = {
    fontFamily: 'var(--rokdock-font-mono, monospace)',
    fontSize: 'var(--rokdock-font-xs, 11px)',
    color: 'var(--rokdock-text)',
    wordBreak: 'break-word',
}

const REDACT_MARK_STYLE: React.CSSProperties = {
    background: 'var(--rokdock-bg-active)',
    color: 'var(--rokdock-text-bright)',
    borderRadius: 3,
    padding: '0 4px',
}

const WARN_BOX_STYLE: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    marginTop: 4,
    padding: '8px 10px',
    background: 'var(--rokdock-bg-subtle)',
    border: '1px solid var(--rokdock-state-error)',
    borderRadius: 'var(--rokdock-radius-sm)',
}

const WARN_TITLE_STYLE: React.CSSProperties = {
    fontSize: 'var(--rokdock-font-sm)',
    fontWeight: 600,
    color: 'var(--rokdock-error-text)',
}

const WARN_ACK_STYLE: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    fontSize: 'var(--rokdock-font-sm)',
    color: 'var(--rokdock-text)',
    cursor: 'pointer',
}

/** AI Settings tab. Manages AI provider profiles: list, add, edit, delete, set active.
 *  Provides a Test Connection button that exercises the full engine seam. */
export default function AiTab(): React.JSX.Element {
    const [profiles, setProfiles] = useState<AiProfile[]>([])
    const [activeId, setActiveId] = useState<string | null>(null)
    const [draft, setDraft] = useState<AiProfileInput>(BLANK)
    const [editingId, setEditingId] = useState<string | null>(null)
    // The result of testing one specific provider (by row). Carries the provider name so the
    // output is unambiguously tied to the provider that was tested.
    const [testResult, setTestResult] = useState<{ providerId: string; providerName: string; text: string; isError: boolean; redacted: string; redactedCount: number } | null>(null)
    const [isBusy, setIsBusy] = useState(false)
    // The name of the provider currently being tested, for the in-progress indicator.
    const [testingName, setTestingName] = useState<string | null>(null)
    // Acknowledgment that a remote profile with redaction off may send device info unredacted.
    const [ackUnredacted, setAckUnredacted] = useState(false)
    // The provider pending a delete confirmation, or null.
    const [deleteTarget, setDeleteTarget] = useState<AiProfile | null>(null)
    // The Add/Edit form is hidden until the user adds or edits, so the tab defaults to a
    // clean provider list rather than a long form.
    const [formOpen, setFormOpen] = useState(false)
    // Whether roBot asks before each state-changing device action. Persisted in AppPreferences
    // so the choice sticks across sessions. Unset defaults to on (confirm).
    const [confirmDeviceControl, setConfirmDeviceControl] = useState(true)

    useEffect(() => {
        void window.rokdock.store.getPreferences().then((preferences: AppPreferences) => {
            setConfirmDeviceControl(preferences.aiConfirmDeviceControl !== false)
        })
    }, [])

    const updateConfirmDeviceControl = async (checked: boolean): Promise<void> => {
        setConfirmDeviceControl(checked) // optimistic: the toggle reflects the choice immediately
        await window.rokdock.store.setPreferences({ aiConfirmDeviceControl: checked })
    }

    const refresh = useCallback(async (): Promise<void> => {
        const list: AiProfile[] = await window.rokdock.ai.listProfiles()
        let active: string | null = await window.rokdock.ai.getActive()
        // Auto-activate-first applies only to saved HTTP profiles. A CLI provider must be
        // chosen explicitly; it is never auto-activated.
        const saved = list.filter(profile => profile.adapter !== 'cli')
        if (saved.length > 0 && !list.some(profile => profile.id === active)) {
            active = saved[0].id
            await window.rokdock.ai.setActive(active)
        }
        setProfiles(list)
        setActiveId(active)
    }, [])

    useEffect(() => {
        void (async () => {
            await window.rokdock.ai.refreshCliDetection()
            await refresh()
        })()
    }, [refresh])

    const setField = <K extends keyof AiProfileInput>(key: K, value: AiProfileInput[K]): void =>
        setDraft(prev => ({ ...prev, [key]: value }))

    const saveDraft = async (): Promise<void> => {
        if (isBusy) return
        setIsBusy(true)
        try {
            if (draft.adapter === 'cli' && draft.cliKind) {
                // A CLI is configured through its override (model + redaction), not as a stored HTTP
                // profile. hidden: false un-removes a CLI that had been removed from the list.
                await window.rokdock.ai.setCliOverride(draft.cliKind, {
                    model: draft.model.trim(),
                    redactionEnabled: draft.redactionEnabled,
                    hidden: false,
                })
            } else {
                // When editing an existing profile, an empty key field means "leave the stored key unchanged".
                // Only a non-empty value replaces the key. For new profiles, send the key as typed.
                const keyToSend = editingId ? (draft.key ? draft.key : undefined) : draft.key
                await window.rokdock.ai.saveProfile({ ...draft, id: editingId ?? undefined, key: keyToSend })
            }
            resetForm(false)
            await refresh()
        } finally {
            setIsBusy(false)
        }
    }

    // Reset the draft/edit/ack state and set whether the form is shown. Shared by the
    // "Add provider" open, Cancel/close, and post-save paths so they cannot drift.
    const resetForm = (open: boolean): void => {
        setDraft(BLANK)
        setEditingId(null)
        setAckUnredacted(false)
        setFormOpen(open)
    }

    const openAddForm = (): void => resetForm(true)
    const closeForm = (): void => resetForm(false)

    const editProfile = (profile: AiProfile): void => {
        setEditingId(profile.id)
        setAckUnredacted(false)
        setFormOpen(true)
        // key is omitted so a save without a new key leaves the stored key untouched.
        setDraft({
            id: profile.id,
            name: profile.name,
            adapter: profile.adapter,
            cliKind: profile.cliKind,
            model: profile.model,
            baseUrl: profile.baseUrl ?? '',
            isLocal: profile.isLocal,
            redactionEnabled: profile.redactionEnabled,
            key: undefined,
        })
    }

    const confirmDelete = async (): Promise<void> => {
        if (!deleteTarget) return
        const target = deleteTarget
        setDeleteTarget(null)
        if (testResult?.providerId === target.id) setTestResult(null)
        if (target.adapter === 'cli' && target.cliKind) {
            // A detected CLI cannot be deleted from disk; "remove" records a hidden override so it
            // drops out of the list. Re-adding it from the form clears the override.
            await window.rokdock.ai.setCliOverride(target.cliKind, { hidden: true })
        } else {
            await window.rokdock.ai.deleteProfile(target.id)
        }
        await refresh()
    }

    const makeActive = async (id: string): Promise<void> => {
        setActiveId(id)  // optimistic: the Active badge moves immediately, no async revert
        await window.rokdock.ai.setActive(id)
        await refresh()
    }

    const TEST_PROMPT = 'Reply with the single word OK.'

    // Test ONE specific provider, by row. Tests exactly that profile (by id), so the result is
    // unambiguously tied to the provider you clicked, and a freshly added provider can be tested
    // immediately from its own row. Also shows what would be sent, redacted per that profile.
    // Uses the one-shot complete() path (enough to prove the seam); the streaming IPC surface is
    // reserved for the future inline AI panel.
    const testProfile = async (profile: AiProfile): Promise<void> => {
        if (isBusy) return
        setIsBusy(true)
        setTestResult(null)
        setTestingName(profile.name)
        try {
            // Independent calls: the redaction preview and the connection test do not
            // depend on each other, so run them together rather than serializing the
            // local preview in front of the network round-trip.
            const [preview, result] = await Promise.all([
                window.rokdock.ai.previewRedaction({ messages: [{ role: 'user', content: TEST_PROMPT }] }, profile.id),
                window.rokdock.ai.testConnection(profile.id),
            ])
            setTestResult({
                providerId: profile.id,
                providerName: profile.name,
                text: result.ok ? (result.text ?? '') : (result.error ?? 'Unknown error'),
                isError: !result.ok,
                redacted: preview.text,
                redactedCount: preview.replacements.reduce((sum: number, replacement: { count: number }) => sum + replacement.count, 0),
            })
        } finally {
            setTestingName(null)
            setIsBusy(false)
        }
    }

    const isCli = draft.adapter === 'cli'
    // Risky combination, evaluated from current state (not the toggle event) so it holds no
    // matter which switch was flipped last: a remote provider with redaction turned off. A CLI
    // runs locally, so the warning never applies to it.
    const remoteUnredacted = !isCli && !draft.isLocal && !draft.redactionEnabled

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rokdock-space-md)' }}>
            <CollapsibleSettingsSection label="Providers" gap={8} padding="10px 14px 10px 14px">
                <div
                    style={PROFILE_LIST_STYLE}
                    // Moving focus onto a provider row (Set active, Test, editing another, or a
                    // keyboard tab into the list) closes a stale open edit form. Capture phase runs
                    // before a row's own click, so clicking Edit closes it here, then that row's
                    // handler reopens the form for the row just clicked.
                    onFocusCapture={() => { if (formOpen) closeForm() }}
                >
                    {profiles.map((profile, index) => {
                        // A CLI provider has no API key; its subtitle reads "CLI" (a CLI is
                        // inherently local, so "local" would be redundant). CLI rows carry
                        // cli-prefixed test ids so they stay addressable.
                        const isCli = profile.adapter === 'cli'
                        return (
                            <div key={profile.id} style={index > 0 ? { ...ROW_STYLE, ...ROW_DIVIDER_STYLE } : ROW_STYLE}>
                                <span style={PROFILE_LABEL_STYLE}>
                                    <span>{profile.name}</span>
                                    <span style={{ color: 'var(--rokdock-text-dim)', fontSize: 'var(--rokdock-font-xs, 11px)' }}>
                                        {isCli ? '(CLI)' : `(${profile.adapter}${profile.hasKey ? ', key stored' : ''})`}
                                    </span>
                                </span>
                                <span style={ACTIVE_SLOT_STYLE}>
                                    {profile.id === activeId ? (
                                        <span style={ACTIVE_BADGE_STYLE} data-testid={isCli ? 'ai-cli-active-badge' : 'ai-active-badge'}>Active</span>
                                    ) : (
                                        <button
                                            type="button"
                                            className="rokdock-btn rokdock-btn-ghost"
                                            style={ROW_BTN_STYLE}
                                            data-testid={isCli ? 'ai-cli-set-active' : 'ai-set-active'}
                                            onClick={() => void makeActive(profile.id)}
                                        >
                                            Set active
                                        </button>
                                    )}
                                </span>
                                <button
                                    type="button"
                                    className="rokdock-btn rokdock-btn-ghost"
                                    style={ROW_BTN_STYLE}
                                    data-testid={isCli ? 'ai-cli-test' : 'ai-row-test'}
                                    disabled={isBusy}
                                    onClick={() => void testProfile(profile)}
                                >
                                    Test
                                </button>
                                <IconButton size="sm" title={`Edit ${profile.name}`} data-testid={isCli ? 'ai-cli-edit' : undefined} onClick={() => editProfile(profile)}>
                                    <FontAwesomeIcon icon={faPen} />
                                </IconButton>
                                <IconButton size="sm" title={isCli ? `Remove ${profile.name}` : `Delete ${profile.name}`} data-testid={isCli ? 'ai-cli-remove' : undefined} onClick={() => setDeleteTarget(profile)}>
                                    <FontAwesomeIcon icon={faTrash} />
                                </IconButton>
                            </div>
                        )
                    })}
                    {profiles.length === 0 && (
                        <span style={EMPTY_STYLE}>No AI providers configured yet.</span>
                    )}
                </div>

                {testingName && (
                    <div
                        data-testid="ai-testing"
                        style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 'var(--rokdock-font-sm)', color: 'var(--rokdock-text-dim)' }}
                    >
                        <FontAwesomeIcon icon={faSpinner} spin />
                        <span>Testing {testingName}...</span>
                    </div>
                )}
                {!testingName && testResult && (
                    <div style={{ marginTop: 8 }}>
                        <div style={{ fontSize: 'var(--rokdock-font-xs, 11px)', color: 'var(--rokdock-text-dim)', marginBottom: 2 }}>
                            Test result for {testResult.providerName}
                        </div>
                        <pre data-testid="ai-test-output" style={TEST_OUTPUT_STYLE}>
                            {testResult.isError ? `Error: ${testResult.text}` : testResult.text}
                        </pre>
                        {!testResult.isError && (
                            <div data-testid="ai-redaction-preview" style={REDACTION_PREVIEW_STYLE}>
                                {formatRedactionNote(testResult.redactedCount, testResult.redacted)}
                            </div>
                        )}
                    </div>
                )}

                {!formOpen && (
                    <button
                        type="button"
                        className="rokdock-btn rokdock-btn-ghost"
                        style={{ marginTop: 8, alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6 }}
                        data-testid="ai-show-add-form"
                        onClick={openAddForm}
                    >
                        <FontAwesomeIcon icon={faPlus} />
                        <span>Add provider</span>
                    </button>
                )}
            </CollapsibleSettingsSection>

            {formOpen && (
            <CollapsibleSettingsSection
                label={editingId ? 'Edit Provider' : 'Add Provider'}
                gap={10}
                padding="10px 14px 10px 14px"
            >
                {!isCli && (
                    <div style={FIELD_STYLE}>
                        <label className="rokdock-label">Name</label>
                        <input
                            className="rokdock-input"
                            type="text"
                            placeholder="My AI Provider"
                            value={draft.name}
                            onChange={e => setField('name', e.target.value)}
                        />
                    </div>
                )}

                <div style={FIELD_STYLE}>
                    <label className="rokdock-label">Provider type</label>
                    <RokdockSelect
                        value={isCli && draft.cliKind ? `cli:${draft.cliKind}` : draft.adapter}
                        onChange={value => {
                            if (value.startsWith('cli:')) {
                                // A CLI is local, keyless, and named after the recognized CLI; clear the
                                // HTTP-only fields so nothing from a previous selection carries over.
                                const kind = value.slice(4) as CliKind
                                setDraft(prev => ({ ...prev, adapter: 'cli', cliKind: kind, name: CLI_DEFINITIONS[kind].label, model: '', baseUrl: '', key: '', isLocal: true }))
                            } else {
                                // Reset the adapter-specific fields so a base URL entered for the previous
                                // adapter never carries into (or saves under) the new one.
                                setDraft(prev => ({ ...prev, adapter: value as AiAdapterType, cliKind: undefined, model: '', baseUrl: '' }))
                            }
                        }}
                        style={{ width: '100%' }}
                    >
                        {PROVIDER_TYPE_OPTIONS.map(option => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </RokdockSelect>
                </div>

                <div style={FIELD_STYLE}>
                    <label className="rokdock-label">Model</label>
                    <input
                        className="rokdock-input"
                        type="text"
                        data-testid="ai-model"
                        placeholder={isCli ? 'CLI default' : MODEL_PLACEHOLDER[draft.adapter]}
                        value={draft.model}
                        onChange={e => setField('model', e.target.value)}
                    />
                </div>

                {!isCli && (
                    <div style={FIELD_STYLE}>
                        <label className="rokdock-label">Base URL (optional)</label>
                        <input
                            className="rokdock-input"
                            type="text"
                            data-testid="ai-base-url"
                            placeholder="e.g., http://localhost:11434/v1"
                            value={draft.baseUrl ?? ''}
                            onChange={e => setField('baseUrl', e.target.value)}
                        />
                    </div>
                )}
                {!isCli && (
                    <div style={FIELD_STYLE}>
                        <label className="rokdock-label">API Key</label>
                        <input
                            className="rokdock-input"
                            type="password"
                            placeholder={editingId ? 'API key (leave blank to keep)' : (draft.isLocal ? 'API key (optional for a local endpoint)' : 'API key')}
                            value={draft.key ?? ''}
                            onChange={e => setField('key', e.target.value)}
                        />
                        <span className="rokdock-hint">Stored encrypted on this machine via your OS keychain. It is never shown again after saving.</span>
                    </div>
                )}

                {!isCli && (
                    <div style={TOGGLE_FIELD_STYLE}>
                        <div style={TOGGLE_ROW_STYLE}>
                            <RokdockToggle
                                checked={draft.isLocal}
                                onChange={({ checked }) => setField('isLocal', checked)}
                            />
                            <span className="rokdock-label" style={{ marginBottom: 0 }}>Local (no data leaves this machine)</span>
                        </div>
                        <span className="rokdock-hint">
                            Turn on for a provider that runs on your machine, like an Ollama CLI or a localhost endpoint. A local provider needs no API key, and redaction is optional because nothing leaves your machine.
                        </span>
                    </div>
                )}

                <div style={TOGGLE_FIELD_STYLE}>
                    <div style={TOGGLE_ROW_STYLE}>
                        <RokdockToggle
                            data-testid="ai-redact-toggle"
                            checked={draft.redactionEnabled}
                            onChange={({ checked }) => setField('redactionEnabled', checked)}
                        />
                        <span className="rokdock-label" style={{ marginBottom: 0 }}>Redact sensitive values</span>
                    </div>
                    <span className="rokdock-hint">
                        Removes known device IPs, names, and serial numbers from your prompt and from terminal output roBot reads. It does not remove other sensitive values (file paths, tokens, or arbitrary debug data), so review what you share with a remote provider.
                    </span>
                    <div style={REDACT_EXAMPLE_STYLE}>
                        <div style={REDACT_ROW_STYLE}>
                            <span style={REDACT_TAG_STYLE}>Before</span>
                            <code style={{ ...REDACT_CODE_STYLE, color: 'var(--rokdock-text-dim)' }}>connect to 192.168.1.50 (Living Room)</code>
                        </div>
                        <div style={REDACT_ROW_STYLE}>
                            <span style={REDACT_TAG_STYLE}>After</span>
                            <code style={REDACT_CODE_STYLE}>connect to <span style={REDACT_MARK_STYLE}>[ip]</span> (<span style={REDACT_MARK_STYLE}>[device]</span>)</code>
                        </div>
                    </div>
                </div>

                {remoteUnredacted && (
                    <div style={WARN_BOX_STYLE} data-testid="ai-unredacted-warning">
                        <span style={WARN_TITLE_STYLE}>Sending unredacted to a remote provider</span>
                        <span className="rokdock-hint">
                            This profile is not marked Local and redaction is off, so your prompts (including any device IPs, names, and serials) will be sent to a remote provider as-is. Mark it Local, turn redaction back on, or acknowledge below to save.
                        </span>
                        <label style={WARN_ACK_STYLE}>
                            <input
                                type="checkbox"
                                checked={ackUnredacted}
                                onChange={e => setAckUnredacted(e.target.checked)}
                                style={{ accentColor: 'var(--rokdock-state-error)', flexShrink: 0, marginTop: 2 }}
                            />
                            <span>I understand, and want to send unredacted to this remote provider.</span>
                        </label>
                    </div>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <button
                        type="button"
                        className="rokdock-btn rokdock-btn-primary"
                        data-testid="ai-add-profile"
                        disabled={isBusy || (remoteUnredacted && !ackUnredacted)}
                        onClick={() => void saveDraft()}
                    >
                        {editingId ? 'Save' : 'Add'}
                    </button>
                    <button
                        type="button"
                        className="rokdock-btn rokdock-btn-ghost"
                        onClick={closeForm}
                    >
                        Cancel
                    </button>
                </div>
            </CollapsibleSettingsSection>
            )}

            <CollapsibleSettingsSection label="Device control" gap={8} padding="10px 14px 10px 14px">
                <div style={TOGGLE_FIELD_STYLE}>
                    <div style={TOGGLE_ROW_STYLE}>
                        <RokdockToggle
                            data-testid="ai-confirm-device-control-toggle"
                            checked={confirmDeviceControl}
                            onChange={({ checked }) => void updateConfirmDeviceControl(checked)}
                        />
                        <span className="rokdock-label" style={{ marginBottom: 0 }}>Confirm before <roBot.Logotype height={13} style={{ verticalAlign: 'baseline', margin: '0 1px' }} /> controls the Roku</span>
                    </div>
                    <span className="rokdock-hint">
                        When on, roBot asks for approval before each device action (pressing remote keys, launching a channel, typing text, opening a deeplink). Turn off to let it act without a prompt. This choice is saved and sticks across sessions.
                    </span>
                </div>
            </CollapsibleSettingsSection>

            <ConfirmDialog
                open={deleteTarget !== null}
                title={deleteTarget?.adapter === 'cli' ? 'Remove CLI' : 'Delete provider'}
                message={deleteTarget?.adapter === 'cli'
                    ? `Remove "${deleteTarget?.name ?? ''}" from the provider list? You can add it back from the provider form.`
                    : `Delete "${deleteTarget?.name ?? ''}"? Its stored API key is also removed. This cannot be undone.`}
                confirmLabel={deleteTarget?.adapter === 'cli' ? 'Remove' : 'Delete'}
                destructive
                onConfirm={() => void confirmDelete()}
                onCancel={() => setDeleteTarget(null)}
            />
        </div>
    )
}
