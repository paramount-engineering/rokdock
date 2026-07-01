import { useEffect, useRef } from 'react'
import type { ComponentProps } from 'react'
import type { Tint } from '@shared/colorTint'
import { ThemeModeSection } from './themeModeSection'
import { FontScaleSection } from './fontScaleSection'
import { ColorAdjustmentsSection } from './colorAdjustmentsSection'
import { CodeAppearanceSection } from './codeAppearanceSection'
import { TerminalAppearanceSection } from './terminalAppearanceSection'
import { CollapsibleSettingsSection } from '../rokdock/wrappers'
import { ResetButton } from './resetButton'
import { IDENTITY_TINT } from '@shared/colorTint'

type ThemeMode = 'dark' | 'light' | 'system'

interface AppearanceTabProps {
    context: { surfaces: { terminal: boolean; code: boolean } }
    initialSection: string | null
    // universal
    themeMode: ThemeMode
    onThemeMode: (m: ThemeMode) => void
    uiFontScale: number
    onUiFontScale: (px: number) => void
    tint: Tint
    onTint: (t: Tint) => void
    // section props passthroughs; required only when the host surface enables that section.
    codeProps?: ComponentProps<typeof CodeAppearanceSection>
    terminalProps?: ComponentProps<typeof TerminalAppearanceSection>
}

/** The Appearance settings tab: universal sections plus host-gated sections.
 *  On open with an `initialSection`, that section is scrolled into view and
 *  briefly highlighted. */
export function AppearanceTab(props: AppearanceTabProps) {
    const { context, initialSection } = props
    const terminalRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (initialSection === 'terminal' && terminalRef.current) {
            terminalRef.current.scrollIntoView({ block: 'start', behavior: 'auto' })
            terminalRef.current.classList.add('rokdock-section-flash')
            const id = window.setTimeout(() => {
                terminalRef.current?.classList.remove('rokdock-section-flash')
            }, 1200)
            return () => window.clearTimeout(id)
        }
    }, [initialSection])

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rokdock-space-md)' }}>
            <CollapsibleSettingsSection
                label="Theme"
                gap={12}
                padding="10px 14px 10px 14px"
                actions={<ResetButton label="Reset" onClick={() => { props.onUiFontScale(0); props.onTint(IDENTITY_TINT) }} />}
            >
                <ThemeModeSection value={props.themeMode} onChange={props.onThemeMode} />
                <FontScaleSection value={props.uiFontScale} onChange={props.onUiFontScale} />
                <ColorAdjustmentsSection tint={props.tint} onChange={props.onTint} />
            </CollapsibleSettingsSection>
            {context.surfaces.code && props.codeProps && (
                <div data-section="code">
                    <CollapsibleSettingsSection label="Code">
                        <CodeAppearanceSection {...props.codeProps} />
                    </CollapsibleSettingsSection>
                </div>
            )}
            {context.surfaces.terminal && props.terminalProps && (
                <div ref={terminalRef} data-section="terminal">
                    <CollapsibleSettingsSection label="Terminal">
                        <TerminalAppearanceSection {...props.terminalProps} />
                    </CollapsibleSettingsSection>
                </div>
            )}
        </div>
    )
}
