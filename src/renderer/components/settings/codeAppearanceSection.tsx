import type { CSSProperties } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faXmark } from '@fortawesome/free-solid-svg-icons'
import { RokdockSelect, RokdockToggle, RokdockSlider } from '../rokdock/wrappers'
import type { TerminalSyntaxThemePreset, TerminalTokenPalette } from '../../styles/terminalSyntaxThemes'

interface CodeAppearanceSectionProps {
    fieldStyle: CSSProperties
    smallBtnStyle: CSSProperties
    sectionStyle: CSSProperties
    colorRowStyle: CSSProperties
    colorInputStyle: CSSProperties
    fontPresets: { value: string; label: string }[]
    terminalThemeOptions: { value: TerminalSyntaxThemePreset; label: string; category: 'none' | 'rokdock' | 'popular' }[]
    fontPickerMode: 'preset' | 'custom'
    setFontPickerMode: (m: 'preset' | 'custom') => void
    localFontFamily: string
    setLocalFontFamily: (v: string) => void
    localFontSize: number
    setLocalFontSize: (v: number) => void
    localSyntaxPreset: TerminalSyntaxThemePreset
    setLocalSyntaxPreset: (v: TerminalSyntaxThemePreset) => void
    localUseThemeBackground: boolean
    setLocalUseThemeBackground: (v: boolean) => void
    localFallbackColor: string
    setLocalFallbackColor: (v: string) => void
    previewSyntaxTheme: { background: string }
    previewColor: (t: keyof TerminalTokenPalette) => string
}

export type { CodeAppearanceSectionProps }

/** Appearance > Code (shared across dock and tool windows). Font and Syntax/Colors settings. */
export function CodeAppearanceSection(props: CodeAppearanceSectionProps) {
    const {
        fieldStyle, smallBtnStyle, sectionStyle, colorRowStyle, colorInputStyle,
        fontPresets, terminalThemeOptions,
        fontPickerMode, setFontPickerMode,
        localFontFamily, setLocalFontFamily,
        localFontSize, setLocalFontSize,
        localSyntaxPreset, setLocalSyntaxPreset,
        localUseThemeBackground, setLocalUseThemeBackground,
        localFallbackColor, setLocalFallbackColor,
        previewSyntaxTheme, previewColor,
    } = props
    return (
        <div style={sectionStyle}>
            <div style={fieldStyle}>
                <label className="rokdock-label">Font Family</label>
                {fontPickerMode === 'preset' ? (
                    <RokdockSelect
                        value={fontPresets.some(font => font.value === localFontFamily) ? localFontFamily : ''}
                        onChange={value => {
                            if (value === '__custom__') {
                                setFontPickerMode('custom')
                                setLocalFontFamily('')
                            } else {
                                setLocalFontFamily(value)
                            }
                        }}
                        style={{ width: '100%' }}
                    >
                        {fontPresets.map(font => (
                            <option key={font.value} value={font.value} style={{ fontFamily: font.value || 'inherit' }}>{font.label}</option>
                        ))}
                        <option value="__custom__">Custom...</option>
                    </RokdockSelect>
                ) : (
                    <div style={{ display: 'flex', gap: 6 }}>
                        <input
                            className="rokdock-input" style={{ flex: 1 }}
                            type="text"
                            value={localFontFamily}
                            onChange={e => setLocalFontFamily(e.target.value)}
                            placeholder="e.g. 'My Font', monospace"
                            autoFocus
                        />
                        <button
                            style={smallBtnStyle}
                            onClick={() => { setFontPickerMode('preset'); setLocalFontFamily('') }}
                            title="Back to presets"
                        ><FontAwesomeIcon icon={faXmark} /></button>
                    </div>
                )}
            </div>
            <RokdockSlider
                min={8}
                max={24}
                step={1}
                value={localFontSize}
                onChange={({ value }) => setLocalFontSize(value)}
                label="Code font size"
                suffix="px"
            />
            <div style={fieldStyle}>
                <label className="rokdock-label">Syntax Theme</label>
                <RokdockSelect
                    value={localSyntaxPreset}
                    onChange={value => setLocalSyntaxPreset(value as TerminalSyntaxThemePreset)}
                    style={{ width: '100%' }}
                >
                    <optgroup label="Style">
                        {terminalThemeOptions.filter(opt => opt.category === 'none').map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </optgroup>
                    <optgroup label="RokDock">
                        {terminalThemeOptions.filter(opt => opt.category === 'rokdock').map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </optgroup>
                    <optgroup label="Popular">
                        {terminalThemeOptions.filter(opt => opt.category === 'popular').map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </optgroup>
                </RokdockSelect>
                <span className="rokdock-hint">
                    {localSyntaxPreset === 'none'
                        ? 'No colorization. Set a fallback text color below.'
                        : 'Built-in presets use standard semantic tokens, so switching themes stays consistent.'}
                </span>
            </div>
            <div style={fieldStyle}>
                <RokdockToggle
                    checked={localUseThemeBackground}
                    onChange={({ checked }) => setLocalUseThemeBackground(checked)}
                >
                    Use theme background color
                </RokdockToggle>
                <span className="rokdock-hint">On by default: the terminal uses the syntax theme's own background. Turn off to match the RokDock panel background instead.</span>
            </div>
            {localSyntaxPreset === 'none' && (
                <div style={fieldStyle}>
                    <label className="rokdock-label">Text Color</label>
                    <div style={colorRowStyle}>
                        <input
                            type="color"
                            value={localFallbackColor}
                            onChange={e => setLocalFallbackColor(e.target.value)}
                            style={colorInputStyle}
                            title="Monochrome terminal text color"
                        />
                        <input
                            className="rokdock-input rokdock-input-mono" style={{ flex: 1 }}
                            type="text"
                            value={localFallbackColor}
                            onChange={e => setLocalFallbackColor(e.target.value)}
                            placeholder="#e0e0e0"
                        />
                    </div>
                </div>
            )}
            <div style={{
                padding: '8px 10px',
                background: localUseThemeBackground
                    ? previewSyntaxTheme.background
                    : 'var(--rokdock-bg-terminal)',
                borderRadius: 'var(--rokdock-radius-sm)',
                fontFamily: localFontFamily || 'var(--rokdock-font-mono)',
                fontSize: localFontSize,
                color: localFallbackColor,
                whiteSpace: 'pre-wrap',
                overflow: 'hidden'
            }}>
                <div>
                    <span style={{ color: previewColor('brightscriptDebuggerPrompt') }}>BrightScript Debugger&gt;</span>
                </div>
                <div>
                    <span style={{ color: previewColor('keyword') }}>if</span>
                    <span style={{ color: previewColor('plain') }}> </span>
                    <span style={{ color: previewColor('functionName') }}>isReady</span>
                    <span style={{ color: previewColor('plain') }}>(</span>
                    <span style={{ color: previewColor('objectStringValue') }}>"player"</span>
                    <span style={{ color: previewColor('plain') }}>) </span>
                    <span style={{ color: previewColor('keyword') }}>then</span>
                </div>
                <div>
                    <span style={{ color: previewColor('prompt') }}>&gt; </span>
                    <span style={{ color: previewColor('functionName') }}>print</span>
                    <span style={{ color: previewColor('plain') }}> </span>
                    <span style={{ color: previewColor('string') }}>"Loading stream"</span>
                    <span style={{ color: previewColor('plain') }}> </span>
                    <span style={{ color: previewColor('number') }}>42</span>
                </div>
                <div>
                    <span style={{ color: previewColor('logTag') }}>[INFO]</span>
                    <span style={{ color: previewColor('plain') }}> 10:20:33 </span>
                    <span style={{ color: previewColor('filePath') }}>pkg:/components/MainScene.brs</span>
                    <span style={{ color: previewColor('plain') }}>(</span>
                    <span style={{ color: previewColor('sourceLineNumber') }}>117</span>
                    <span style={{ color: previewColor('plain') }}>{`): `}</span>
                    <span style={{ color: previewColor('warning') }}>timeout warning</span>
                </div>
                <div>
                    <span style={{ color: previewColor('objectPunctuation') }}>{'{'}</span>
                    <span style={{ color: previewColor('objectKey') }}>"id"</span>
                    <span style={{ color: previewColor('objectPunctuation') }}>:</span>
                    <span style={{ color: previewColor('objectNumberValue') }}> 1</span>
                    <span style={{ color: previewColor('objectPunctuation') }}>, </span>
                    <span style={{ color: previewColor('objectKey') }}>"ok"</span>
                    <span style={{ color: previewColor('objectPunctuation') }}>:</span>
                    <span style={{ color: previewColor('objectBooleanValue') }}> true</span>
                    <span style={{ color: previewColor('objectPunctuation') }}>{' }'}</span>
                </div>
            </div>
        </div>
    )
}
