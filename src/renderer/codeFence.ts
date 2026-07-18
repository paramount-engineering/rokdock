/**
 * Wrap text in a Markdown fenced code block so a chat / markdown renderer shows it
 * verbatim and monospaced instead of re-flowing it as prose. Used by the terminal
 * "Ask roBot" action so pasted debug output keeps its line breaks and spacing.
 *
 * The fence grows past the longest backtick run in the text: CommonMark requires an
 * opening fence to be longer than any backtick run it encloses, so output that
 * itself contains backticks still fences correctly.
 *
 * Pass `language` to tag the opening fence (e.g. 'brightscript') so the renderer
 * syntax-highlights the block instead of showing it as plain monospaced text.
 */
export function wrapInCodeFence(text: string, language = ''): string {
    const longestBacktickRun = Math.max(
        0,
        ...Array.from(text.matchAll(/`+/g), match => match[0].length),
    )
    const fence = '`'.repeat(Math.max(3, longestBacktickRun + 1))
    return `${fence}${language}\n${text}\n${fence}`
}
