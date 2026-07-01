import { RokdockSegmented } from '../rokdock/wrappers'

type ThemeMode = 'dark' | 'light' | 'system'

interface ThemeModeSectionProps {
    value: ThemeMode
    onChange: (mode: ThemeMode) => void
}

const OPTIONS: { value: ThemeMode; label: string }[] = [
    { value: 'light', label: 'Light' },
    { value: 'system', label: 'System' },
    { value: 'dark', label: 'Dark' },
]

/** The theme-mode control (segmented Light / System / Dark) inside the Theme section. */
export function ThemeModeSection({ value, onChange }: ThemeModeSectionProps) {
    return (
        <>
            <RokdockSegmented
                value={value}
                options={OPTIONS}
                ariaLabel="Theme mode"
                onChange={({ value }) => onChange(value as ThemeMode)}
            />
            <span className="rokdock-hint">System follows your OS appearance setting.</span>
        </>
    )
}
