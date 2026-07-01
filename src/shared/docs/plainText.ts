/**
 * Reduce markdown to its bare words. Strips syntax (code fences, emphasis, links,
 * images, headings, list markers, tables, HTML tags, escapes) but keeps the readable
 * content, including code bodies. Whitespace is collapsed to single spaces.
 *
 * Shared by the docs full-text search index (main process) and the What's New diff
 * filter (renderer), so "what is the prose, ignoring formatting" is defined once.
 */
/**
 * Collect the link and image targets (URLs) from markdown, in order, as a single
 * newline-joined string. markdownToPlainText deliberately discards these, so the
 * What's New "Content only" filter pairs the two: text-equivalent edits that change
 * a link href or an image src are still worth surfacing, not formatting-only noise.
 *
 * Covers markdown links/images `[text](url)` / `![alt](url)`, autolinks `<url>`, and
 * HTML `href=`/`src=` attributes (the docs mix in raw HTML and JSX-ish tags).
 */
export function extractLinkTargets(markdown: string): string {
    const targets: string[] = []
    for (const match of markdown.matchAll(/!?\[[^\]]*\]\(([^)\s]+)/g)) targets.push(match[1])
    for (const match of markdown.matchAll(/<((?:https?|ftp|mailto):[^>\s]+)>/g)) targets.push(match[1])
    for (const match of markdown.matchAll(/\b(?:href|src)\s*=\s*["']([^"']*)["']/gi)) targets.push(match[1])
    return targets.join('\n')
}

export function markdownToPlainText(markdown: string): string {
    return markdown
        .replace(/^[ \t]*(```|~~~).*$/gm, '')          // code-fence lines (open/close), even indented
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')      // images -> alt
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')       // inline links -> text
        .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')      // reference links -> text
        .replace(/`([^`]*)`/g, '$1')                   // inline code -> content
        .replace(/<[^>]+>/g, '')                       // HTML tags
        .replace(/^\s{0,3}#{1,6}\s+/gm, '')            // heading markers
        .replace(/^\s{0,3}>\s?/gm, '')                 // blockquote markers
        .replace(/^\s*([-*+]|\d+[.)])\s+/gm, '')       // list markers
        .replace(/^[\s|:\-=]+$/gm, '')                 // table separators / hr
        .replace(/\|/g, ' ')                           // table cell pipes
        .replace(/[*_~]/g, '')                         // emphasis / strikethrough
        .replace(/\\([\\`*_{}[\]()#+\-.!|>])/g, '$1')  // backslash escapes
        .replace(/\s+/g, ' ')                          // collapse all whitespace
        .trim()
}
