import type { CSSProperties } from 'react'
import { RokdockSelect, RokdockToggle } from '../rokdock/wrappers'
import type { TabLabelMode } from '../../store/appStore'

interface TerminalAppearanceSectionProps {
    fieldStyle: CSSProperties
    localTabLabelMode: TabLabelMode
    setLocalTabLabelMode: (m: TabLabelMode) => void
    localHighlightAppLaunchLines: boolean
    setLocalHighlightAppLaunchLines: (enabled: boolean) => void
}

/** Appearance > Terminal (dock only). Tab label format and app-run banding settings. */
export function TerminalAppearanceSection(props: TerminalAppearanceSectionProps) {
    const {
        fieldStyle,
        localTabLabelMode, setLocalTabLabelMode,
        localHighlightAppLaunchLines, setLocalHighlightAppLaunchLines
    } = props
    return (
        <>
            <div style={fieldStyle}>
                <label className="rokdock-label">Tab Label Format</label>
                <RokdockSelect
                    value={localTabLabelMode}
                    onChange={value => setLocalTabLabelMode(value as TabLabelMode)}
                    style={{ width: '100%' }}
                >
                    <option value="displayName">Display Name (Port)</option>
                    <option value="ip">IP Address:Port</option>
                </RokdockSelect>
                <span className="rokdock-hint">Controls the text shown in terminal tabs.</span>
            </div>
            <div style={fieldStyle}>
                <RokdockToggle
                    checked={localHighlightAppLaunchLines}
                    onChange={({ checked }) => setLocalHighlightAppLaunchLines(checked)}
                >
                    Band output by app run
                </RokdockToggle>
                <span className="rokdock-hint">
                    Alternates a subtle background tint each time the Roku console reports a new app
                    run, so one launch's output is visually distinct from the next while scrolling. A
                    thin line always marks exactly where each run started.
                </span>
            </div>
        </>
    )
}
