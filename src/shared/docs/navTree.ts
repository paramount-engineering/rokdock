import { DocsTreeNode } from './types'

/**
 * Pure nav-tree helpers for the Developer Docs tool window.
 */

/**
 * Convert a kebab-case or snake_case slug into a title-cased display label.
 * e.g. 'external-control-api' -> 'External Control Api'
 */
export function humanizeSlug(slug: string): string {
    return slug
        .split(/[-_]/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
}

/**
 * Extract the basename-minus-.md slug from a repo-relative file path.
 * Returns the raw basename (not lowercased); callers that need lowercase
 * should apply .toLowerCase() themselves.
 */
export function slugFromPath(filePath: string): string {
    const segments = filePath.split('/')
    const basename = segments[segments.length - 1]
    return basename.endsWith('.md') ? basename.slice(0, -3) : basename
}

/**
 * Build a flat slug -> path index from a list of repo-relative file paths.
 * Only .md files are indexed. For a path ending in /index.md the key is the
 * parent folder name (lowercased); for all other pages the key is the
 * basename minus .md (lowercased). If two paths produce the same slug, last
 * one wins.
 */
export function buildSlugIndex(paths: string[]): Record<string, string> {
    const index: Record<string, string> = {}
    for (const filePath of paths) {
        if (!filePath.endsWith('.md')) continue
        const segments = filePath.split('/')
        const basename = segments[segments.length - 1]
        let slug: string
        if (basename === 'index.md' && segments.length >= 2) {
            slug = segments[segments.length - 2].toLowerCase()
        } else {
            slug = basename.slice(0, -3).toLowerCase()
        }
        index[slug] = filePath
    }
    return index
}

/**
 * Build a nested navigation tree from a flat list of repo-relative file paths.
 * Each path is split on '/' into segments. Directory segments become
 * kind: 'directory' nodes with children; the final .md segment becomes a
 * kind: 'page' node. The slug of each node is its segment basename (minus
 * .md for pages). The path on directory nodes is the accumulated directory
 * path; on page nodes it is the full .md file path.
 *
 * An index.md inside a directory is folded into that directory node as its
 * indexPath (the directory opens the index when clicked) rather than appearing
 * as a separate "Index" child.
 */
export function buildNavTree(paths: string[]): DocsTreeNode[] {
    const roots: DocsTreeNode[] = []

    for (const filePath of paths) {
        const segments = filePath.split('/')
        let currentChildren = roots
        let accumulatedPath = ''

        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i]
            const isLast = i === segments.length - 1
            accumulatedPath = accumulatedPath === '' ? segment : accumulatedPath + '/' + segment

            if (isLast) {
                // Page node: strip .md extension from slug
                const slug = segment.endsWith('.md') ? segment.slice(0, -3) : segment
                const existing = currentChildren.find(node => node.slug === slug && node.kind === 'page')
                if (!existing) {
                    currentChildren.push({
                        slug,
                        label: humanizeSlug(slug),
                        path: accumulatedPath,
                        kind: 'page',
                    })
                }
            } else {
                // Directory node
                let dirNode = currentChildren.find(node => node.slug === segment && node.kind === 'directory')
                if (!dirNode) {
                    dirNode = {
                        slug: segment,
                        label: humanizeSlug(segment),
                        path: accumulatedPath,
                        kind: 'directory',
                        children: [],
                    }
                    currentChildren.push(dirNode)
                }
                currentChildren = dirNode.children!
            }
        }
    }

    foldIndexPages(roots)
    return roots
}

/**
 * Fold each directory's index.md child into the directory node's indexPath and
 * remove it from the children list, recursing through the tree. A directory
 * with an index opens that page when clicked instead of listing "Index"
 * separately.
 */
function foldIndexPages(nodes: DocsTreeNode[]): void {
    for (const node of nodes) {
        if (node.kind !== 'directory' || !node.children) continue
        const indexAt = node.children.findIndex(indexChild => indexChild.kind === 'page' && indexChild.slug.toLowerCase() === 'index')
        if (indexAt !== -1) {
            node.indexPath = node.children[indexAt].path
            node.children.splice(indexAt, 1)
        }
        foldIndexPages(node.children)
    }
}

/**
 * Return a new array of children ordered by the slug sequence from an
 * _order.yaml file. Children whose slug does not appear in orderSlugs are
 * appended after the ordered ones, sorted alphabetically by slug.
 */
export function orderChildren<T extends { slug: string }>(children: T[], orderSlugs: string[]): T[] {
    // Build an index map once so membership and position lookups are O(1).
    const orderIndex = new Map(orderSlugs.map((slug, i) => [slug, i]))

    const ordered: T[] = []
    const unordered: T[] = []

    for (const child of children) {
        if (orderIndex.has(child.slug)) {
            ordered.push(child)
        } else {
            unordered.push(child)
        }
    }

    ordered.sort((nodeA, nodeB) => orderIndex.get(nodeA.slug)! - orderIndex.get(nodeB.slug)!)
    unordered.sort((nodeA, nodeB) => nodeA.slug.localeCompare(nodeB.slug))

    return [...ordered, ...unordered]
}

/**
 * Extract an arbitrary single-line scalar value from a YAML front-matter block
 * at the top of a markdown string. Strips surrounding single or double quotes
 * from the value. Returns null if no front-matter block is found or the key is
 * not present. Handles both LF and CRLF line endings. The closing `---` may be
 * followed by a newline or appear at end-of-file with no trailing newline.
 */
export function parseFrontMatterField(md: string, key: string): string | null {
    if (!/^---\r?\n/.test(md)) return null
    // Accept closing --- followed by a newline OR at end-of-file.
    const closeMatch = /\r?\n---((\r?\n)|$)/.exec(md.slice(3))
    if (!closeMatch) return null
    const endIndex = 3 + closeMatch.index
    const frontMatter = md.slice(md.indexOf('\n') + 1, endIndex)
    const keyPattern = new RegExp(`^${key}:\\s*(.+)$`)
    for (const line of frontMatter.split(/\r?\n/)) {
        const match = line.match(keyPattern)
        if (match) {
            return match[1].trim().replace(/^['"]|['"]$/g, '')
        }
    }
    return null
}

/**
 * Extract the title value from a YAML front-matter block at the top of a
 * markdown string. Strips surrounding single or double quotes from the value.
 * Returns null if no front-matter block is found or no title key is present.
 */
export function parseFrontMatterTitle(md: string): string | null {
    return parseFrontMatterField(md, 'title')
}

/**
 * Return the markdown body with the leading front-matter block removed.
 * If no front-matter is present the original string is returned unchanged.
 * Accepts a closing `---` followed by a newline or at end-of-file.
 */
export function stripFrontMatter(md: string): string {
    if (!/^---\r?\n/.test(md)) return md
    const closeMatch = /\r?\n---((\r?\n)|$)/.exec(md.slice(3))
    if (!closeMatch) return md
    const closeEnd = 3 + closeMatch.index + closeMatch[0].length
    return md.slice(closeEnd)
}

/**
 * Truncation-tolerant scan of the leading front-matter block in a chunk of
 * markdown that may be cut off mid-stream (e.g. an HTTP Range response). Does
 * NOT require the closing `---` to be present.
 *
 * Extracts `title` (quote-stripped) and `hidden: true` from the YAML block.
 * Returns `{ hidden: false }` when the chunk does not start with `---`.
 */
export function parseFrontMatterMeta(chunk: string): { title?: string; hidden: boolean } {
    if (!/^---\r?\n/.test(chunk)) return { hidden: false }
    // Find the first line after the opening ---.
    const firstNewline = chunk.indexOf('\n')
    if (firstNewline === -1) return { hidden: false }
    // Scan up to the closing --- (if present) or to end-of-chunk.
    const rest = chunk.slice(firstNewline + 1)
    const closeMatch = /^---(?:\r?\n|$)/m.exec(rest)
    const fmText = closeMatch ? rest.slice(0, closeMatch.index) : rest

    let title: string | undefined
    let hidden = false

    for (const line of fmText.split(/\r?\n/)) {
        if (!title) {
            const titleMatch = line.match(/^title:\s*(.+?)\s*$/)
            if (titleMatch) {
                title = titleMatch[1].replace(/^['"]|['"]$/g, '')
            }
        }
        if (/^hidden:\s*true\s*$/.test(line)) {
            hidden = true
        }
    }

    return { title, hidden }
}
