import { useEffect, useState } from 'react'
import { RokdockSlider } from '../rokdock/wrappers'
import type { Tint } from '@shared/colorTint'
import { BRAND_BASE_HUE } from '@shared/themeData'

interface ColorAdjustmentsSectionProps {
    tint: Tint
    onChange: (tint: Tint) => void
}

/** Width wide enough for "Saturation" and "Brightness" so all three label
 *  columns are identical and the tracks start at the same x. */
const LABEL_WIDTH = '76px'

/** Hue track gradient. Depends only on the module constant BRAND_BASE_HUE so it
 *  is built once at module load rather than on every render. */
const HUE_GRADIENT = (() => {
    const stops = [0, 60, 120, 180, 240, 300, 360]
        .map(degreeOffset => `hsl(${(BRAND_BASE_HUE + degreeOffset) % 360} 70% 50%)`)
        .join(', ')
    return `linear-gradient(90deg, ${stops})`
})()

/** Tracks the live resolved theme (light vs dark) so the gradient preview tracks
 *  can stay in a tonal band that suits the current background. Initialized from
 *  the applied document class and updated on the theme-change broadcast. */
function useIsLightTheme(): boolean {
    const [isLight, setIsLight] = useState(
        () => typeof document !== 'undefined' && document.documentElement.classList.contains('theme-light')
    )
    useEffect(() => {
        const onThemeChanged = (event: Event) => {
            const detail = (event as CustomEvent<{ themeMode?: 'dark' | 'light' }>).detail
            setIsLight(detail?.themeMode === 'light')
        }
        window.addEventListener('rokdock-theme-changed', onThemeChanged)
        return () => window.removeEventListener('rokdock-theme-changed', onThemeChanged)
    }, [])
    return isLight
}

/** The color (tint) controls inside the Theme section: Hue / Saturation /
 *  Brightness sliders over the tintable token set, plus a swatch strip preview. */
export function ColorAdjustmentsSection({ tint, onChange }: ColorAdjustmentsSectionProps) {
    const resultHue = (BRAND_BASE_HUE + tint.hue) % 360
    const isLight = useIsLightTheme()
    // The Hue track is the same vivid rainbow in both themes. The Saturation and
    // Brightness tracks keep a lighter tonal band in light mode so their low ends do
    // not render as heavy dark bars against the light panel (and the original darker
    // band in dark mode, where it blends with the dark panel).
    const satGradient = isLight
        ? `linear-gradient(90deg, hsl(${resultHue} 8% 80%), hsl(${resultHue} 75% 60%))`
        : `linear-gradient(90deg, hsl(${resultHue} 0% 50%), hsl(${resultHue} 90% 50%))`
    const briGradient = isLight
        ? `linear-gradient(90deg, hsl(${resultHue} 50% 55%), hsl(${resultHue} 52% 72%), hsl(${resultHue} 45% 92%))`
        : `linear-gradient(90deg, hsl(${resultHue} 60% 20%), hsl(${resultHue} 60% 50%), hsl(${resultHue} 60% 85%))`

    return (
        <>
            <RokdockSlider
                min={0} max={359} step={1} value={tint.hue}
                onChange={({ value }) => onChange({ ...tint, hue: value })}
                label="Hue" suffix="deg"
                labelWidth={LABEL_WIDTH}
                trackBackground={HUE_GRADIENT}
            />
            <RokdockSlider
                min={0} max={200} step={1} value={Math.round(tint.saturation * 100)}
                onChange={({ value }) => onChange({ ...tint, saturation: value / 100 })}
                label="Saturation" suffix="%"
                labelWidth={LABEL_WIDTH}
                trackBackground={satGradient}
            />
            <RokdockSlider
                min={-25} max={25} step={1} value={Math.round(tint.brightness * 100)}
                onChange={({ value }) => onChange({ ...tint, brightness: value / 100 })}
                label="Brightness" suffix="%"
                labelWidth={LABEL_WIDTH}
                trackBackground={briGradient}
            />
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }} aria-hidden="true">
                {['--rokdock-bg-base', '--rokdock-bg-panel', '--rokdock-bg-surface', '--rokdock-brand-primary'].map(varName => (
                    <span key={varName} style={{
                        width: 28, height: 18, borderRadius: 'var(--rokdock-radius-sm)',
                        background: `var(${varName})`, border: '1px solid var(--rokdock-border)',
                    }} />
                ))}
            </div>
        </>
    )
}
