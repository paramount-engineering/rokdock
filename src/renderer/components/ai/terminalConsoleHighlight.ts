/**
 * Highlights raw Roku debug-console text the same way the terminal panel does, for
 * echoing an "Ask roBot" selection in the AI chat. It reuses the shared line
 * tokenizer and the terminal's segment builder so the colors match the terminal
 * exactly, then paints each segment with the active terminal syntax theme.
 *
 * Overlays (clickable URLs, expandable JSON) are intentionally dropped: the chat
 * echo is read-only, so only the token colors carry over, not the interactivity.
 */
import { tokenizeTerminalLine } from '@shared/terminalTokenizer'
import { escapeHtml } from '@shared/htmlEscape'
import { buildSegments } from '../terminal/overlayCompiler'
import type { TerminalSyntaxTheme } from '../../styles/terminalSyntaxThemes'

export function highlightConsoleToHtml(text: string, theme: TerminalSyntaxTheme): string {
    return text
        .split('\n')
        .map(line =>
            buildSegments(tokenizeTerminalLine(line))
                .map(segment => {
                    const color = theme.colors[segment.kind] ?? theme.colors.plain
                    return `<span style="color: ${color}">${escapeHtml(segment.text)}</span>`
                })
                .join(''),
        )
        .join('\n')
}
