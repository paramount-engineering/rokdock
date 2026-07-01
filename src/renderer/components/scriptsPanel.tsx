/**
 * Panel listing saved automation scripts with playback controls.
 *
 * Scripts are loaded from the main process via window.rokdock.scripts.list()
 * on mount and whenever the script-library:changed IPC event fires (e.g., after
 * saving or deleting a script in the Script Editor window).
 *
 * For each script entry the panel shows:
 *  - Script name
 *  - Step count (flat-expanded, accounting for loop iterations)
 *  - Play / Stop button - play starts execution for the currently targeted device;
 *    if the script contains ${variable} tokens, VariablesDialog is shown first
 *    to collect substitution values before playback begins.
 *  - Open in editor button - opens the Script Editor tool window.
 *  - Delete button with ConfirmDialog - removes the script via IPC.
 *
 * During playback, progress events (script-engine:progress) update a step
 * counter badge on the active script row. The play button changes to a stop
 * button while running, allowing the user to halt execution early.
 *
 * The "Open Script Editor" button at the top opens the editor without a
 * specific script selected (new script mode).
 */
import React, { useState, useCallback, useEffect, useRef } from 'react'
import { useAppStore } from '../store/appStore'
import { resolveThemeMode } from '../styles/theme'
import CollapsibleSection from './common/collapsibleSection'
import ConfirmDialog from './common/confirmDialog'
import IconButton from './common/iconButton'
import VariablesDialog from './common/variablesDialog'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlay, faRotateRight, faScroll, faStop, faTrash } from '@fortawesome/free-solid-svg-icons'

interface ScriptEntry {
    name: string
    filePath: string
    modifiedAt: number
}

/** Count steps the way the engine does - flat index including nested loop iterations. */
function countFlatSteps(steps: unknown[]): number {
    let count = 0
    for (const raw of steps) {
        const step = raw as { type?: string; steps?: unknown[]; iterations?: number; disabled?: boolean }
        if (step.disabled) continue
        if (step.type === 'block') continue
        count++
        if (step.type === 'loop' && step.steps && step.iterations) {
            count += countFlatSteps(step.steps) * step.iterations
        }
    }
    return count
}

/**
 * Collapsible panel listing saved automation scripts with play, stop, edit,
 * and delete controls. Supports drag-to-reorder and prompts for variable
 * substitution before running scripts that contain token placeholders.
 */
export default function ScriptsPanel() {
    const themeMode = resolveThemeMode(useAppStore(state => state.themeMode))
    const remoteTargetIp = useAppStore(state => state.remoteTargetIp)
    const [scripts, setScripts] = useState<ScriptEntry[]>([])
    const [playingPath, setPlayingPath] = useState<string | null>(null)
    const [playingStep, setPlayingStep] = useState<number | null>(null)
    const [totalSteps, setTotalSteps] = useState<number | null>(null)
    const [deleteTarget, setDeleteTarget] = useState<ScriptEntry | null>(null)
    const [varPrompt, setVarPrompt] = useState<{ script: Record<string, unknown>; filePath: string; scriptName: string; variables: Record<string, string> } | null>(null)

    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
    const [dragOverHalf, setDragOverHalf] = useState<'top' | 'bottom'>('bottom')
    const dragSrcIndex = useRef<number | null>(null)

    /** Fetches the current script library from the main process and updates local state. */
    const loadScripts = useCallback(async () => {
        const result = await window.rokdock.scriptEditor.list()
        if (result.ok && result.scripts) {
            setScripts(result.scripts)
        }
    }, [])

    useEffect(() => {
        void loadScripts()
    }, [loadScripts])

    useEffect(() => {
        const cleanup = window.rokdock.scriptEditor.onScriptsChanged(() => {
            void loadScripts()
        })
        return cleanup
    }, [loadScripts])

    useEffect(() => {
        const cleanup = window.rokdock.scriptEditor.onEngineEvent((ev: unknown) => {
            const event = ev as { type: string; index?: number }
            switch (event.type) {
                case 'step-start':
                    setPlayingStep((event.index ?? 0) + 1)
                    break
                case 'engine-complete':
                case 'engine-failed':
                case 'engine-stopped':
                    setPlayingPath(null)
                    setPlayingStep(null)
                    setTotalSteps(null)
                    break
            }
        })
        return cleanup
    }, [])


    /** Loads a script by path and opens it in the Script Editor tool window. */
    const openScript = useCallback(async (filePath: string) => {
        const result = await window.rokdock.scriptEditor.load(filePath)
        if (result.ok && result.script) {
            const script = result.script as { steps: unknown[]; name: string; metadata?: unknown }
            await window.rokdock.scriptEditor.open({
                steps: script.steps,
                name: script.name,
                metadata: script.metadata,
                filePath,
                themeMode,
                deviceIp: remoteTargetIp ?? undefined
            })
        }
    }, [themeMode, remoteTargetIp])

    /**
     * Begins execution of a loaded script object against the currently selected
     * device. Sets playback state immediately so the UI shows progress; the
     * playing state is cleared by engine-complete/failed/stopped events.
     */
    const launchScript = useCallback(async (script: Record<string, unknown>, filePath: string) => {
        const steps = (script as { steps: unknown[] }).steps
        setPlayingPath(filePath)
        setPlayingStep(0)
        setTotalSteps(countFlatSteps(steps))
        await window.rokdock.scriptEditor.play(script, remoteTargetIp!)
        // playingPath is cleared by engine events, not here
    }, [remoteTargetIp])

    /**
     * Handles the Play button click for a script row. Loads the script file,
     * checks whether it contains variable tokens, and either opens the
     * VariablesDialog to collect values first or calls launchScript directly.
     */
    const playScript = useCallback(async (filePath: string, e: React.MouseEvent) => {
        e.stopPropagation()
        if (!remoteTargetIp || playingPath) return
        const result = await window.rokdock.scriptEditor.load(filePath)
        if (!result.ok || !result.script) return
        const script = result.script as Record<string, unknown>
        const steps = (script as { steps: unknown[] }).steps
        const tokens = window.rokdock.scriptEditor.extractTokens(steps)
        if (tokens.length > 0) {
            const metadata = (script as { metadata?: { variables?: Record<string, string> } }).metadata
            const existing = metadata?.variables ?? {}
            const variables: Record<string, string> = {}
            for (const token of tokens) {
                variables[token] = existing[token] ?? ''
            }
            const scriptName = (script as { name?: string }).name ?? ''
            setVarPrompt({ script, filePath, scriptName, variables })
            return
        }
        await launchScript(script, filePath)
    }, [remoteTargetIp, playingPath, launchScript])

    /**
     * Called when the user confirms variable values in VariablesDialog. Patches
     * the in-memory script metadata with the provided values and starts playback.
     */
    const handleVarConfirm = useCallback(async (values: Record<string, string>) => {
        if (!varPrompt) return
        const script = varPrompt.script as { metadata?: { variables?: Record<string, string> } }
        if (!script.metadata) script.metadata = {}
        script.metadata.variables = values
        setVarPrompt(null)
        await launchScript(varPrompt.script, varPrompt.filePath)
    }, [varPrompt, launchScript])

    /** Sends a stop signal to the script engine and clears all playback state. */
    const stopPlayback = useCallback(async () => {
        await window.rokdock.scriptEditor.stopPlayback()
        setPlayingPath(null)
        setPlayingStep(null)
        setTotalSteps(null)
    }, [])

    /** Deletes the pending script file via IPC and refreshes the list. */
    const confirmDelete = useCallback(async () => {
        if (!deleteTarget) return
        await window.rokdock.scriptEditor.delete(deleteTarget.filePath)
        setDeleteTarget(null)
        await loadScripts()
    }, [deleteTarget, loadScripts])

    const styles = buildStyles()

    const headerActions = (
        <>
            {playingPath && (
                <IconButton
                    size="sm"
                    title="Stop script"
                    onClick={() => { void stopPlayback() }}
                >
                    <span style={{ color: 'var(--rokdock-btn-danger)' }}>
                        <FontAwesomeIcon icon={faStop} />
                    </span>
                </IconButton>
            )}
            <IconButton size="sm" title="Open Script Editor" onClick={() => {
                void window.rokdock.scriptEditor.open({ themeMode, deviceIp: remoteTargetIp ?? undefined })
            }}>
                <FontAwesomeIcon icon={faScroll} />
            </IconButton>
            <IconButton size="sm" title="Refresh" onClick={() => { void loadScripts() }}>
                <FontAwesomeIcon icon={faRotateRight} />
            </IconButton>
        </>
    )

    const isPlaying = !!playingPath

    const scriptsTitle = isPlaying ? (
        <>
            Scripts
            <span style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--rokdock-state-online)',
                marginLeft: 6,
                boxShadow: '0 0 6px var(--rokdock-state-online)',
                animation: 'rokdock-pulse 1.5s ease-in-out infinite'
            }} />
        </>
    ) : 'Scripts'

    return (<>
        <CollapsibleSection
            title={scriptsTitle}
            id="scripts"
            actions={headerActions}
            defaultOpen={false}
            className={isPlaying ? 'rokdock-scripts-playing' : undefined}
        >
            {isPlaying && (
                <style>{`
                    @keyframes rokdock-pulse {
                        0%, 100% { opacity: 1; box-shadow: 0 0 8px var(--rokdock-state-online-glow); }
                        50% { opacity: 0.4; box-shadow: 0 0 3px var(--rokdock-state-online-glow-dim); }
                    }
                    @keyframes rokdock-border-pulse {
                        0%, 100% {
                            outline-color: var(--rokdock-script-running-border);
                            box-shadow: 0 0 6px var(--rokdock-script-running-border-dim);
                        }
                        50% {
                            outline-color: var(--rokdock-script-running-border-dim);
                            box-shadow: 0 0 2px var(--rokdock-script-running-border-dim);
                        }
                    }
                    .rokdock-scripts-playing {
                        outline: 1px solid var(--rokdock-script-running-border);
                        outline-offset: -1px;
                        animation: rokdock-border-pulse 1.5s ease-in-out infinite !important;
                    }
                `}</style>
            )}
            <div style={styles.list}>
                {scripts.length === 0 ? (
                    <div style={styles.empty}>No scripts saved yet</div>
                ) : (
                    scripts.map((script, i) => {
                        const isRunning = playingPath === script.filePath
                        const isDimmed = isPlaying && !isRunning
                        const isDragTarget = dragOverIndex === i
                        return (
                            <div
                                key={script.filePath}
                                draggable={!isPlaying}
                                onDragStart={e => {
                                    dragSrcIndex.current = i
                                    e.dataTransfer.effectAllowed = 'move'
                                    e.dataTransfer.setData('text/plain', script.filePath)
                                }}
                                onDragOver={e => {
                                    e.preventDefault()
                                    e.dataTransfer.dropEffect = 'move'
                                    const rect = e.currentTarget.getBoundingClientRect()
                                    const half = e.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom'
                                    setDragOverIndex(i)
                                    setDragOverHalf(half)
                                }}
                                onDragLeave={() => { if (dragOverIndex === i) setDragOverIndex(null) }}
                                onDrop={e => {
                                    e.preventDefault()
                                    setDragOverIndex(null)
                                    const from = dragSrcIndex.current
                                    if (from == null || from === i) return
                                    const rect = e.currentTarget.getBoundingClientRect()
                                    const half = e.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom'
                                    const reordered = [...scripts]
                                    const [moved] = reordered.splice(from, 1)
                                    let to = half === 'top' ? i : i + 1
                                    if (from < i) to--
                                    reordered.splice(to, 0, moved)
                                    setScripts(reordered)
                                    void window.rokdock.scriptEditor.saveSortOrder(reordered.map(entry => entry.filePath))
                                }}
                                onDragEnd={() => { setDragOverIndex(null); dragSrcIndex.current = null }}
                                style={{
                                    ...styles.item,
                                    ...(isRunning ? {
                                        background: 'linear-gradient(90deg, var(--rokdock-state-online-faded), var(--rokdock-bg-active))',
                                        borderLeftColor: 'var(--rokdock-state-online)',
                                        color: 'var(--rokdock-text-bright)',
                                        fontWeight: 500
                                    } : {
                                        borderLeftColor: 'rgba(0, 0, 0, 0)' // not 'transparent' - renders as white on Windows
                                    }),
                                    opacity: isDimmed ? 0.4 : 1,
                                    ...(isDragTarget ? {
                                        [dragOverHalf === 'top' ? 'borderTop' : 'borderBottom']: '2px solid var(--rokdock-brand-primary)'
                                    } : {})
                                }}
                                onClick={() => { void openScript(script.filePath) }}
                                title={isRunning ? `Running "${script.name}"` : `Open "${script.name}" in editor`}
                                onMouseEnter={e => {
                                    const row = e.currentTarget as HTMLElement
                                    if (!isRunning) row.style.background = 'var(--rokdock-bg-hover)'
                                    if (isDimmed) row.style.opacity = '1'
                                    const grip = row.querySelector('[data-grip]') as HTMLElement | null
                                    if (grip) grip.style.opacity = '1'
                                }}
                                onMouseLeave={e => {
                                    const row = e.currentTarget as HTMLElement
                                    row.style.background = isRunning ? 'linear-gradient(90deg, var(--rokdock-state-online-faded), var(--rokdock-bg-active))' : 'transparent'
                                    if (isDimmed) row.style.opacity = '0.4'
                                    const grip = row.querySelector('[data-grip]') as HTMLElement | null
                                    if (grip) grip.style.opacity = '0'
                                }}
                            >
                                <span data-grip style={{ ...styles.dragHandle, ...(isPlaying ? { visibility: 'hidden' as const } : {}) }}>&#8286;</span>
                                <span style={styles.itemName}>{script.name}</span>
                                {isRunning ? (
                                    <span style={{
                                        fontSize: 'var(--rokdock-font-xxs)',
                                        color: 'var(--rokdock-text-muted)',
                                        whiteSpace: 'nowrap',
                                        flexShrink: 0
                                    }}>
                                        {playingStep ?? 0} / {totalSteps ?? 0}
                                    </span>
                                ) : (
                                    <>
                                        <button
                                            style={{
                                                ...styles.actionBtn,
                                                ...(!remoteTargetIp || isPlaying ? { opacity: 0.3, cursor: 'default' } : {})
                                            }}
                                            title={remoteTargetIp ? 'Play' : 'Select a device to play'}
                                            disabled={!remoteTargetIp || isPlaying}
                                            onClick={e => { void playScript(script.filePath, e) }}
                                        >
                                            <FontAwesomeIcon icon={faPlay} />
                                        </button>
                                        <button
                                            style={styles.actionBtn}
                                            title="Delete"
                                            onClick={e => { e.stopPropagation(); setDeleteTarget(script) }}
                                        >
                                            <FontAwesomeIcon icon={faTrash} />
                                        </button>
                                    </>
                                )}
                            </div>
                        )
                    })
                )}
            </div>
        </CollapsibleSection>
        <VariablesDialog
            open={!!varPrompt}
            scriptName={varPrompt?.scriptName ?? ''}
            variables={varPrompt?.variables ?? {}}
            onCancel={() => setVarPrompt(null)}
            onConfirm={(values) => { void handleVarConfirm(values) }}
        />
        <ConfirmDialog
            open={!!deleteTarget}
            title="Delete Script"
            message={`Delete "${deleteTarget?.name}"?`}
            confirmLabel="Delete"
            destructive
            onCancel={() => setDeleteTarget(null)}
            onConfirm={() => { void confirmDelete() }}
        />
    </>)
}

/** Builds the inline style map for ScriptsPanel list items and controls. */
function buildStyles() {
    return {
        list: {
            padding: '2px 0 4px'
        } as React.CSSProperties,
        empty: {
            padding: '6px 10px',
            fontSize: 'var(--rokdock-font-xs)',
            color: 'var(--rokdock-text-muted)',
            fontStyle: 'italic'
        } as React.CSSProperties,
        item: {
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 4px 3px 0',
            minHeight: 24,
            borderLeft: '3px solid rgba(0, 0, 0, 0)', // not 'transparent' - renders as white on Windows
            cursor: 'pointer',
            fontSize: 'var(--rokdock-font-sm)',
            color: 'var(--rokdock-text-dim)',
            userSelect: 'none',
            borderRadius: 3,
            margin: '1px 2px 1px 0',
            transition: 'background 0.1s ease, opacity 0.1s ease'
        } as React.CSSProperties,
        dragHandle: {
            width: 12,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--rokdock-text-muted)',
            cursor: 'grab',
            opacity: 0,
            transition: 'opacity 0.1s',
            fontSize: 'var(--rokdock-font-xs)'
        } as React.CSSProperties,
        itemName: {
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
        } as React.CSSProperties,
        actionBtn: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 18,
            height: 18,
            border: 'none',
            borderRadius: 3,
            background: 'transparent',
            color: 'var(--rokdock-text-muted)',
            cursor: 'pointer',
            padding: 0,
            fontSize: 'var(--rokdock-font-xxs)',
            flexShrink: 0
        } as React.CSSProperties
    }
}
