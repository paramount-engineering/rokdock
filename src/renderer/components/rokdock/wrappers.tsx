/**
 * React wrapper components for the rokdock-controls custom element library.
 *
 * The rokdock-controls library (src/shared/rokdock-controls/) defines a set
 * of web components as custom elements (e.g., <rokdock-toggle>, <rokdock-slider>).
 * Because React does not natively bridge custom element events and properties,
 * each component here:
 *  1. Creates the custom element via React.createElement with the tag name.
 *  2. Uses refs + useEffect to attach event listeners for custom events
 *     (e.g., 'rokdock-change') and translate them into standard React callbacks.
 *  3. Sets non-attribute properties (like arrays or objects) imperatively on
 *     the element ref after mount.
 *
 * useCustomEvent<T>: shared hook that attaches a typed CustomEvent listener
 * to a ref'd element and removes it on cleanup. Used by all wrappers.
 *
 * Exported wrappers (a subset is re-exported from index.ts):
 *  - RokdockToolbar: <rokdock-toolbar> with left/right slot support.
 *  - RokdockIconBtn: <rokdock-icon-btn> with icon, label, disabled, onClick.
 *  - RokdockToggle: <rokdock-toggle> controlled checkbox/switch with onChange.
 *  - RokdockSlider: <rokdock-slider> range input with label and onChange.
 *  - RokdockSegmented: <rokdock-segmented> mutually-exclusive choice group.
 *  - RokdockCollapsible: <rokdock-collapsible> accordion section.
 *  - RokdockCard: <rokdock-card> list item card with icon/content/actions slots.
 *  - RokdockChip: <rokdock-chip> colored badge label.
 *  - RokdockSelect: <rokdock-select> dropdown with option children.
 *  - CollapsibleSettingsSection: convenience wrapper around RokdockCollapsible
 *    with settings-specific styling.
 */
import React, { useRef, useEffect } from 'react'

/**
 * Generic hook for bridging a single custom element event to a React callback.
 * Attaches an event listener to the element behind the given ref, unwraps the
 * CustomEvent detail, and passes it to the callback. The listener is removed
 * automatically when the component unmounts or when the ref, event name, or
 * callback changes.
 *
 * @param ref - Ref pointing to the target custom element.
 * @param eventName - The custom event name to listen for (e.g. 'rokdock-change').
 * @param callback - Called with the typed event detail whenever the event fires.
 */
function useCustomEvent<T = unknown>(
    ref: React.RefObject<HTMLElement | null>,
    eventName: string,
    callback?: (detail: T) => void
) {
    useEffect(() => {
        const element = ref.current
        if (!element || !callback) return
        const handler = (e: Event) => callback((e as CustomEvent).detail)
        element.addEventListener(eventName, handler)
        return () => element.removeEventListener(eventName, handler)
    }, [ref, eventName, callback])
}

// --- Toolbar ---
/**
 * Props for {@link RokdockToolbar}.
 */
interface RokdockToolbarProps {
    children?: React.ReactNode
    left?: React.ReactNode
    right?: React.ReactNode
}

/**
 * Renders a <rokdock-toolbar> custom element. Children placed in the `left`
 * prop are projected into the 'left' named slot; children in the `right` prop
 * go into the 'right' slot. Unslotted children render in the default slot.
 */
export function RokdockToolbar({ children, left, right }: RokdockToolbarProps) {
    return React.createElement('rokdock-toolbar', null,
        left && React.createElement('span', { slot: 'left' }, left),
        children,
        right && React.createElement('span', { slot: 'right' }, right),
    )
}

// --- Icon Button ---
/**
 * Props for {@link RokdockIconBtn}.
 */
interface RokdockIconBtnProps {
    title?: string
    disabled?: boolean
    size?: 'sm' | 'md' | 'lg'
    onClick?: () => void
    children?: React.ReactNode
}

/**
 * Renders a <rokdock-icon-btn> custom element. Bridges the 'rokdock-click'
 * custom event to the React `onClick` callback. Children are rendered as the
 * button icon content.
 */
export function RokdockIconBtn({ title, disabled, size, onClick, children }: RokdockIconBtnProps) {
    const ref = useRef<HTMLElement>(null)
    useCustomEvent(ref, 'rokdock-click', onClick)
    return React.createElement('rokdock-icon-btn', {
        ref, title, size,
        disabled: disabled ? '' : undefined,
    }, children)
}

// --- Toggle ---
/**
 * Props for {@link RokdockToggle}.
 */
interface RokdockToggleProps {
    checked?: boolean
    disabled?: boolean
    onChange?: (detail: { checked: boolean }) => void
    children?: React.ReactNode
    /** Optional test id forwarded to the underlying element for e2e targeting. */
    'data-testid'?: string
}

/**
 * Renders a <rokdock-toggle> custom element (a toggle switch / checkbox).
 * The 'rokdock-change' event is bridged to the React `onChange` callback,
 * which receives `{ checked: boolean }` in its detail.
 */
export function RokdockToggle({ checked, disabled, onChange, children, 'data-testid': testId }: RokdockToggleProps) {
    const ref = useRef<HTMLElement>(null)
    useCustomEvent(ref, 'rokdock-change', onChange)
    return React.createElement('rokdock-toggle', {
        ref,
        checked: checked ?? false,
        disabled: disabled ? '' : undefined,
        'data-testid': testId,
    }, children)
}

// --- Slider ---
/**
 * Props for {@link RokdockSlider}.
 */
interface RokdockSliderProps {
    min?: number
    max?: number
    step?: number
    value?: number
    disabled?: boolean
    onChange?: (detail: { value: number }) => void
    label?: React.ReactNode
    suffix?: React.ReactNode
    /** When set, fixes the label column to this CSS width so multiple sliders
     *  in a group align their tracks at the same x position. */
    labelWidth?: string
    /** When set, overrides the track fill with this CSS background value
     *  (e.g. a gradient). When absent the default --rokdock-border fill is used. */
    trackBackground?: string
}

/**
 * Renders a <rokdock-slider> custom element (a labeled range input). Numeric
 * props are coerced to strings for the custom element attribute API.
 * Optional `label` and `suffix` children are projected into named slots.
 * The 'rokdock-change' event is bridged to `onChange` with `{ value: number }`.
 * Optional `labelWidth` and `trackBackground` map to the same-named attributes.
 */
export function RokdockSlider({ min, max, step, value, disabled, onChange, label, suffix, labelWidth, trackBackground }: RokdockSliderProps) {
    const ref = useRef<HTMLElement>(null)
    useCustomEvent(ref, 'rokdock-change', onChange)
    return React.createElement('rokdock-slider', {
        ref,
        min: min?.toString(), max: max?.toString(),
        step: step?.toString(), value: value?.toString(),
        disabled: disabled ? '' : undefined,
        'label-width': labelWidth,
        'track-background': trackBackground,
    },
        label && React.createElement('span', { slot: 'label' }, label),
        suffix && React.createElement('span', { slot: 'suffix' }, suffix),
    )
}

// --- Collapsible ---
/**
 * Props for {@link RokdockCollapsible}.
 */
interface RokdockCollapsibleProps {
    label: string
    accent?: string
    defaultOpen?: boolean
    onToggle?: (detail: { open: boolean }) => void
    badge?: React.ReactNode
    actions?: React.ReactNode
    children?: React.ReactNode
}

/**
 * Renders a <rokdock-collapsible> accordion section. The header label and
 * optional accent color are set as attributes. `badge` and `actions` children
 * are projected into named slots. The 'rokdock-toggle' event is bridged to
 * `onToggle` with `{ open: boolean }`.
 */
export function RokdockCollapsible({ label, accent, defaultOpen, onToggle, badge, actions, children }: RokdockCollapsibleProps) {
    const ref = useRef<HTMLElement>(null)
    useCustomEvent(ref, 'rokdock-toggle', onToggle)
    return React.createElement('rokdock-collapsible', {
        ref, label, accent,
        'default-open': defaultOpen === false ? 'false' : undefined,
    },
        badge && React.createElement('span', { slot: 'badge' }, badge),
        actions && React.createElement('span', { slot: 'actions' }, actions),
        children,
    )
}

// --- CollapsibleSettingsSection ---
/**
 * Props for {@link CollapsibleSettingsSection}.
 */
interface CollapsibleSettingsSectionProps {
    label: string
    badge?: React.ReactNode
    actions?: React.ReactNode
    defaultOpen?: boolean
    onToggle?: (detail: { open: boolean }) => void
    gap?: number
    padding?: string
    children?: React.ReactNode
}

/**
 * Convenience wrapper around {@link RokdockCollapsible} with settings-panel
 * styling. Renders children inside a vertically stacked flex container with a
 * gradient left border that visually links items to the section header.
 * Defaults: gap=12, padding='8px 12px 2px 14px'.
 */
export function CollapsibleSettingsSection({
    label,
    badge,
    actions,
    defaultOpen,
    onToggle,
    gap = 12,
    padding = '8px 12px 2px 14px',
    children
}: CollapsibleSettingsSectionProps) {
    return (
        <RokdockCollapsible label={label} defaultOpen={defaultOpen} onToggle={onToggle} badge={badge} actions={actions}>
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap,
                padding,
                borderLeft: '2px solid',
                borderImage: 'linear-gradient(to bottom, var(--rokdock-section-header-bg), var(--rokdock-border) 70%, transparent) 1'
            }}>
                {children}
            </div>
        </RokdockCollapsible>
    )
}

// --- Card ---
/**
 * Props for {@link RokdockCard}.
 */
interface RokdockCardProps {
    selected?: boolean
    onSelect?: () => void
    icon?: React.ReactNode
    actions?: React.ReactNode
    children?: React.ReactNode
}

/**
 * Renders a <rokdock-card> list-item card. Optional `icon` and `actions`
 * children are projected into named slots. The 'rokdock-select' event is
 * bridged to the `onSelect` callback.
 */
export function RokdockCard({ selected, onSelect, icon, actions, children }: RokdockCardProps) {
    const ref = useRef<HTMLElement>(null)
    useCustomEvent(ref, 'rokdock-select', onSelect)
    return React.createElement('rokdock-card', {
        ref,
        selected: selected ? '' : undefined,
    },
        icon && React.createElement('span', { slot: 'icon' }, icon),
        children,
        actions && React.createElement('span', { slot: 'actions' }, actions),
    )
}

// --- Chip ---
/**
 * Props for {@link RokdockChip}.
 */
interface RokdockChipProps {
    color?: string
    children?: React.ReactNode
}

/**
 * Renders a <rokdock-chip> colored badge. The `color` prop sets the chip's
 * accent color attribute; children are the chip's text content.
 */
export function RokdockChip({ color, children }: RokdockChipProps) {
    return React.createElement('rokdock-chip', { color }, children)
}

// --- Select ---
/**
 * Props for {@link RokdockSelect}.
 */
interface RokdockSelectProps {
    value?: string
    onChange?: (value: string) => void
    disabled?: boolean
    className?: string
    style?: React.CSSProperties
    children?: React.ReactNode
}

/**
 * Renders a <rokdock-select> dropdown. Bridges the 'rokdock-change' custom
 * event to the React `onChange` callback, unwrapping the string value from
 * the event detail. Children should be <option> elements.
 */
export function RokdockSelect({ value, onChange, disabled, className, style, children }: RokdockSelectProps) {
    const ref = useRef<HTMLElement>(null)
    useCustomEvent<{ value: string }>(ref, 'rokdock-change', onChange ? (detail) => onChange(detail.value) : undefined)
    return React.createElement('rokdock-select', {
        ref, value, className, style,
        disabled: disabled ? '' : undefined,
    }, children)
}

// --- Segmented ---
/**
 * Props for {@link RokdockSegmented}.
 */
interface RokdockSegmentedProps {
    value: string
    options: { value: string; label: string }[]
    onChange?: (detail: { value: string }) => void
    ariaLabel?: string
}

/**
 * Renders a <rokdock-segmented> custom element (a segmented button group for
 * a small set of mutually exclusive choices). Options are serialized to the
 * element's `options` attribute as JSON. The 'rokdock-change' event is bridged
 * to `onChange` with `{ value: string }`.
 */
export function RokdockSegmented({ value, options, onChange, ariaLabel }: RokdockSegmentedProps) {
    const ref = useRef<HTMLElement>(null)
    useCustomEvent(ref, 'rokdock-change', onChange)
    return React.createElement('rokdock-segmented', {
        ref,
        value,
        options: JSON.stringify(options),
        'aria-label': ariaLabel,
    })
}
