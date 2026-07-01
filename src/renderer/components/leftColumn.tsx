/**
 * The left-column panel: Devices, AI Chat, and docked Capture Preview as three
 * peer collapsible sections stacked vertically.
 *
 * Extracted from app.tsx for testability. Receives no props; reads everything
 * from the app store. App renders this inside its left panel shell (border,
 * width-resize handle), so this component owns only the content above the chrome.
 *
 * Renders:
 *  - DevicePanel always present (collapsible via its own header; 'left-devices' id).
 *  - When aiConfigured: AiChatPanel as a peer section below devices.
 *  - When captureDockSide==='left' and captureMode==='docked': CapturePreview as
 *    the last section (self-collapsing via its own CollapsibleSection header).
 *
 * The old draggable split divider and leftSplitRatio usage are replaced by flex
 * peer sizing: each open section claims equal flex space; collapsed sections shrink
 * to auto height. leftSplitRatio remains in the store but is not used here.
 */

import React from 'react'
import { useAppStore } from '../store/appStore'
import DevicePanel from './devicePanel'
import AiChatPanel from './ai/aiChatPanel'
import CapturePreview from './capturePreview'

export default function LeftColumn(): React.JSX.Element {
    const aiConfigured = useAppStore(state => state.aiConfigured)
    const aiChatOpen = useAppStore(state => state.aiChatOpen)
    const aiChatDock = useAppStore(state => state.aiChatDock)
    const collapsedPanels = useAppStore(state => state.collapsedPanels)
    const captureDockSide = useAppStore(state => state.captureDockSide)
    const captureMode = useAppStore(state => state.captureMode)

    const devicesOpen = !collapsedPanels.includes('left-devices')
    const captureVisible = captureDockSide === 'left' && captureMode === 'docked'

    return (
        <div style={styles.content}>
            <div style={sectionWrapper(devicesOpen)}>
                <DevicePanel />
            </div>
            {aiConfigured && aiChatDock === 'left' && (
                <div style={sectionWrapper(aiChatOpen)}>
                    <AiChatPanel />
                </div>
            )}
            {captureVisible && (
                <CapturePreview mode="docked" active={true} />
            )}
        </div>
    )
}

const sectionWrapper = (open: boolean): React.CSSProperties => ({
    flex: open ? '1 1 0' : '0 0 auto',
    minHeight: 0,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
})

const styles: Record<string, React.CSSProperties> = {
    content: {
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        paddingRight: 3,
    },
}
