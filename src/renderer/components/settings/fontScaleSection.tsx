import { RokdockSlider } from '../rokdock/wrappers'

interface FontScaleSectionProps {
    /** Offset in px applied to the base UI font size (-5 to +5, 0 = default). */
    value: number
    onChange: (px: number) => void
}

/** The UI font-size control inside the Theme section. Nudges --rokdock-font-base
 *  by -5 to +5 px, shifting the whole UI type scale (every size is calc'd off the
 *  base). Window zoom is handled separately by Ctrl+= / Ctrl+-, so this is typography
 *  only. */
export function FontScaleSection({ value, onChange }: FontScaleSectionProps) {
    return (
        <>
            <RokdockSlider
                min={-5}
                max={5}
                step={1}
                value={value}
                onChange={({ value }) => onChange(value)}
                label="UI font size"
                suffix="px"
            />
            <span className="rokdock-hint">Adjusts the base UI font size across every RokDock window.</span>
        </>
    )
}
