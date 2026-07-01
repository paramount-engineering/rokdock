/**
 * Pure link rewriter for Roku developer docs markdown.
 *
 * Handles the following link origins:
 *   - doc:<slug>[#anchor]  - cross-document slug protocol
 *   - relative .md paths   - resolved against the current document's directory
 *   - bare #anchor         - in-page anchor, kept as-is
 *   - external http/https  - passed through unchanged
 *   - dead Confluence URLs - flagged as dead (SomePage_12345.html pattern)
 *
 * POSIX path resolution is done inline (no node:path import) so this module
 * is safe to use in any environment.
 */

export type DocLinkTarget =
    | { kind: 'internal'; path: string; anchor?: string }
    | { kind: 'external'; href: string }
    | { kind: 'dead' }

/** Dead Confluence migration artifact basename pattern: SomePage_12345.html */
const CONFLUENCE_PATTERN = /^[A-Za-z0-9]+_\d+\.html$/

/**
 * Resolve a POSIX-style path by joining a base directory path and a relative
 * href, then normalising away any '.' and '..' segments.
 *
 * Both inputs use forward-slash separators. The result never has a leading
 * slash (paths in this codebase are repo-relative).
 */
function resolvePosixPath(baseDir: string, relativePath: string): string {
    // Split the anchor off the relative path before doing path work.
    const hashIndex = relativePath.indexOf('#')
    const pathPart = hashIndex === -1 ? relativePath : relativePath.slice(0, hashIndex)

    const baseParts = baseDir === '' ? [] : baseDir.split('/')
    const relParts = pathPart.split('/')
    const combined = [...baseParts, ...relParts]

    const resolved: string[] = []
    for (const segment of combined) {
        if (segment === '.' || segment === '') {
            // '.' is a no-op; ignore empty segments produced by leading slashes
            continue
        } else if (segment === '..') {
            resolved.pop()
        } else {
            resolved.push(segment)
        }
    }

    return resolved.join('/')
}

/**
 * Resolve a markdown link href to a typed target.
 *
 * @param href - the raw href from the markdown link
 * @param slugIndex - map from lowercase slug to repo-relative file path
 * @param currentPath - repo-relative path of the document containing the link
 */
export function resolveDocLink(
    href: string,
    slugIndex: Record<string, string>,
    currentPath: string,
): DocLinkTarget {
    // doc: protocol - cross-document slug reference
    if (href.startsWith('doc:')) {
        const withoutPrefix = href.slice(4)
        const hashIndex = withoutPrefix.indexOf('#')
        const slug = (hashIndex === -1 ? withoutPrefix : withoutPrefix.slice(0, hashIndex)).toLowerCase()
        const anchor = hashIndex === -1 ? undefined : withoutPrefix.slice(hashIndex + 1)
        const path = slugIndex[slug]
        if (!path) return { kind: 'dead' }
        return { kind: 'internal', path, ...(anchor ? { anchor } : {}) }
    }

    // External URLs
    if (href.startsWith('https://') || href.startsWith('http://') || href.startsWith('//')) {
        return { kind: 'external', href }
    }

    // Dead Confluence migration artifacts (matched against the last path segment
    // so prefixed paths like ../legacy/SomePage_12345.html are also classified dead).
    const hrefBasename = href.includes('/') ? href.slice(href.lastIndexOf('/') + 1) : href
    if (CONFLUENCE_PATTERN.test(hrefBasename)) {
        return { kind: 'dead' }
    }

    // Relative .md link (optionally with #anchor)
    const mdPattern = /^[^#]*\.md(#.*)?$/
    if (mdPattern.test(href)) {
        const hashIndex = href.indexOf('#')
        const pathPart = hashIndex === -1 ? href : href.slice(0, hashIndex)
        const anchor = hashIndex === -1 ? undefined : href.slice(hashIndex + 1)

        const baseDir = currentPath.includes('/')
            ? currentPath.slice(0, currentPath.lastIndexOf('/'))
            : ''

        const resolvedPath = resolvePosixPath(baseDir, pathPart)
        return { kind: 'internal', path: resolvedPath, ...(anchor ? { anchor } : {}) }
    }

    // Bare anchor - internal link within the current page
    if (href.startsWith('#')) {
        return { kind: 'internal', path: currentPath, anchor: href.slice(1) }
    }

    // Default: let the system browser try
    return { kind: 'external', href }
}
