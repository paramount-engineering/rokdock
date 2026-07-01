/**
 * TypeScript JSX intrinsic element declarations for rokdock custom elements.
 *
 * Extends JSX.IntrinsicElements so that tool windows and React components
 * that use rokdock-controls tags directly (rather than through the React
 * wrappers in src/renderer/components/rokdock/) get correct attribute types
 * and autocomplete without TypeScript errors.
 */
// Declare custom elements for JSX / TypeScript
declare namespace JSX {
    interface IntrinsicElements {
        'rokdock-icon-btn': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & {
            disabled?: string; size?: string; title?: string
        }, HTMLElement>
        'rokdock-toggle': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & {
            checked?: string; disabled?: string
        }, HTMLElement>
        'rokdock-slider': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & {
            min?: string; max?: string; step?: string; value?: string; disabled?: string
        }, HTMLElement>
        'rokdock-collapsible': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & {
            label?: string; accent?: string; open?: string; 'default-open'?: string
        }, HTMLElement>
        'rokdock-card': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & {
            selected?: string
        }, HTMLElement>
        'rokdock-chip': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & {
            color?: string
        }, HTMLElement>
        'rokdock-tabs': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>
        'rokdock-tab': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & {
            label?: string; active?: string; dirty?: string; closable?: string
        }, HTMLElement>
        'rokdock-panel': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & {
            flat?: string
        }, HTMLElement>
        'rokdock-toolbar': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>
        'rokdock-zoom-dock': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & {
            min?: string; max?: string; value?: string; 'show-fit'?: string; 'show-actual'?: string
        }, HTMLElement>
        'rokdock-number-input': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & {
            min?: string; max?: string; step?: string; value?: string; disabled?: string
        }, HTMLElement>
        'rokdock-pill-input': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & {
            label?: string; value?: string; suffix?: string; min?: string; max?: string
        }, HTMLElement>
        'rokdock-select': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & {
            value?: string; disabled?: string
        }, HTMLElement>
        'rokdock-checkerboard': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>
        'rokdock-remote': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & {
            disabled?: string; device?: string; 'keys-active'?: string
        }, HTMLElement>
        'rokdock-segmented': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & {
            value?: string; options?: string
        }, HTMLElement>
        'rokdock-settings-gear': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & {
            slot?: string; title?: string
        }, HTMLElement>
    }
}
