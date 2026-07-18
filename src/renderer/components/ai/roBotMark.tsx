/**
 * roBot brand marks: the wordmark (remote icon + "roBot" logotype) and the standalone
 * glyph (the remote icon alone). Both are self-contained vector SVGs with no font
 * dependency (the "roBot" text is traced to outlines), imported as raw markup. The marks
 * are decorative (aria-hidden); each caller supplies its own context-specific text
 * equivalent (the panel header names it "roBot", the toolbar button carries its own label,
 * the streaming state names its "roBot is thinking" live region). Size is set on the host
 * element, never by mutating the markup: the SVGs carry width/height 100% so they fill it.
 * Any glow/shadow is applied by the caller through `style`/`className`, never baked in.
 *
 * Exported as a `roBot` namespace so callers write <roBot.Wordmark /> / <roBot.Glyph />,
 * preserving the brand's essential lowercase r (a plain component symbol would have to be
 * PascalCase for JSX, whereas a member-expression tag may start lowercase).
 */
import React from 'react'
import wordmarkRaw from './assets/roBotWordmark.svg?raw'
import logotypeRaw from './assets/roBotLogotype.svg?raw'
import glyphRaw from './assets/roBotGlyph.svg?raw'
import glyphMonoRaw from './assets/roBotGlyphMono.svg?raw'

// Each mark's aspect ratio is read from its own (content-cropped) viewBox so the host never
// has wasted space beside the art and the ratio can never drift from the asset.
function aspectFromViewBox(raw: string): number {
    const viewBox = raw.match(/viewBox="\s*[\d.-]+\s+[\d.-]+\s+([\d.-]+)\s+([\d.-]+)/)
    return viewBox ? Number(viewBox[1]) / Number(viewBox[2]) : 1
}
const WORDMARK_ASPECT = aspectFromViewBox(wordmarkRaw)
/** Width/height aspect of the logotype and glyph, exported so a caller can size them in font-relative
 *  `em` units (height + matching width) to sit at the same scale as surrounding text. */
export const LOGOTYPE_ASPECT = aspectFromViewBox(logotypeRaw)
export const GLYPH_ASPECT = aspectFromViewBox(glyphRaw)

const SVG_HOST: React.CSSProperties = { display: 'inline-flex', lineHeight: 0 }

interface MarkProps {
    className?: string
    style?: React.CSSProperties
}

/** Decorative inline-SVG host: sizing lives here, the SVG (width/height 100%) fills it. */
function RawMark({ raw, width, height, className, style }: MarkProps & { raw: string; width: number; height: number }): React.JSX.Element {
    return (
        <span
            aria-hidden
            className={className}
            style={{ ...SVG_HOST, width, height, ...style }}
            dangerouslySetInnerHTML={{ __html: raw }}
        />
    )
}

/**
 * The full roBot wordmark (remote icon + logotype), sized by height. The "ro" glyphs are
 * filled with currentColor and inherit `--rokdock-text-dim` (near-white on dark, a medium gray
 * on light). That keeps them legible in both themes while avoiding the near-black text-bright,
 * which reads as heavy in light mode. "Bot" keeps its purple gradient.
 */
function Wordmark({ height = 22, className, style }: MarkProps & { height?: number }): React.JSX.Element {
    return <RawMark raw={wordmarkRaw} width={Math.round(height * WORDMARK_ASPECT)} height={height} className={className} style={{ color: 'var(--rokdock-text-dim)', ...style }} />
}

/**
 * The roBot logotype alone (the "roBot" wordmark text with NO remote icon), sized by height.
 * Same coloring as the wordmark: "ro" inherits `--rokdock-text-dim` (near-white on dark, gray on
 * light) and "Bot" keeps its purple gradient. For inline use in running text, where the icon would
 * be out of place (e.g. a settings label).
 */
function Logotype({ height = 16, className, style }: MarkProps & { height?: number }): React.JSX.Element {
    return <RawMark raw={logotypeRaw} width={Math.round(height * LOGOTYPE_ASPECT)} height={height} className={className} style={{ color: 'var(--rokdock-text-dim)', ...style }} />
}

/**
 * The standalone roBot glyph (the narrow remote icon), sized by `size` as its height. The
 * width follows the remote's aspect so there is no wasted space beside it. The default is the
 * full-color remote; `mono` swaps to a single-color outline that inherits the caller's text
 * color (currentColor), for sitting inline with monochrome icons (e.g. the About list).
 */
function Glyph({ size = 16, mono = false, className, style }: MarkProps & { size?: number; mono?: boolean }): React.JSX.Element {
    return <RawMark raw={mono ? glyphMonoRaw : glyphRaw} width={Math.round(size * GLYPH_ASPECT)} height={size} className={className} style={style} />
}

/** Brand marks namespace: <roBot.Wordmark />, <roBot.Logotype />, and <roBot.Glyph />. */
export const roBot = { Wordmark, Logotype, Glyph }
