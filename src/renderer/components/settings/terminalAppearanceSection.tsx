import type { CSSProperties } from 'react'
import { RokdockSelect } from '../rokdock/wrappers'
import type { TabLabelMode } from '../../store/appStore'

interface TerminalAppearanceSectionProps {
    fieldStyle: CSSProperties
    localTabLabelMode: TabLabelMode
    setLocalTabLabelMode: (m: TabLabelMode) => void
}

/** Appearance > Terminal (dock only). Tab label format setting. */
export function TerminalAppearanceSection(props: TerminalAppearanceSectionProps) {
    const { fieldStyle, localTabLabelMode, setLocalTabLabelMode } = props
    return (
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
    )
}
