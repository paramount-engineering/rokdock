/**
 * DocsTree: a collapsible navigation tree for the Developer Docs tool window.
 *
 * The tree is fully labeled and ordered by the time it arrives from getTree().
 * Expand/collapse is local state, but the tree also syncs to the open page:
 * opening a page expands its ancestors and scrolls it into view.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react'
import type { DocsTreeNode } from '@shared/docs/types'
import { Caret } from '../common/caret'

/** A tiny sticky-note glyph marking a tree page that has a personal note. */
function NoteMarker(): React.JSX.Element {
    return (
        <span className="docs-nav-note" title="This page has a note" aria-label="Has a note">
            <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
                <path d="M1.5 1.5h9v5.5l-3.5 3.5h-5.5z" fill="#fde047" stroke="#caa93a" strokeWidth="0.8" strokeLinejoin="round" />
                <path d="M10.5 7l-3.5 3.5v-3.5z" fill="#e7c64a" />
            </svg>
        </span>
    )
}

/** Accumulated directory paths that are ancestors of a repo-relative file path. */
function ancestorPaths(filePath: string): string[] {
    const segments = filePath.split('/')
    segments.pop()
    const paths: string[] = []
    let accumulated = ''
    for (const segment of segments) {
        accumulated = accumulated === '' ? segment : accumulated + '/' + segment
        paths.push(accumulated)
    }
    return paths
}

// ---------------------------------------------------------------------------
// TreeNode
// ---------------------------------------------------------------------------

interface TreeNodeProps {
    node: DocsTreeNode
    depth: number
    activePath: string | null
    expandedPaths: Set<string>
    notedPaths?: Set<string>
    onToggleDirectory: (node: DocsTreeNode) => void
    onOpenPage: (node: DocsTreeNode) => void
}

// Memoized so editing a note (which re-renders DocsView and the tree on every
// keystroke) only re-renders nodes whose props actually change. This relies on
// the callbacks and the notedPaths set keeping stable identities between
// keystrokes. DocsTree itself is intentionally left unmemoized: wrapping it
// shifted the timing of its active-page scrollIntoView effect and stole focus
// from the quick-open palette.
const TreeNode = React.memo(function TreeNode({
    node,
    depth,
    activePath,
    expandedPaths,
    notedPaths,
    onToggleDirectory,
    onOpenPage,
}: TreeNodeProps): React.JSX.Element {
    // Top-level categories are expand-only headers (matching the site): clicking
    // a category toggles it rather than opening its index page.
    const expandOnly = node.kind === 'directory' && depth === 0
    const opensIndex = node.kind === 'directory' && !expandOnly && !!node.indexPath

    // A directory with an index page is "active" when its index is the open page.
    // Expand-only categories never open their index, so they never go active.
    const isActive = !expandOnly && (node.indexPath ?? node.path) === activePath
    const isExpanded = expandedPaths.has(node.path)
    const indentLeft = 10 + depth * 15

    const rowClassName = `docs-nav-row${isActive ? ' docs-nav-row--active' : ''}`

    // Open a directory's index page (if it has one), expanding it on the way.
    const openDirectoryIndex = (indexPath: string) => {
        onOpenPage({ ...node, path: indexPath })
        if (!isExpanded) onToggleDirectory(node)
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (node.kind === 'directory') {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                if (opensIndex) openDirectoryIndex(node.indexPath!)
                else onToggleDirectory(node)
            } else if (e.key === 'ArrowRight' && !isExpanded) {
                e.preventDefault()
                onToggleDirectory(node)
            } else if (e.key === 'ArrowLeft' && isExpanded) {
                e.preventDefault()
                onToggleDirectory(node)
            }
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpenPage(node)
        }
    }

    if (node.kind === 'directory') {
        const children = node.children ?? []
        // A nested directory's label opens its index page when present; a
        // top-level category and any index-less directory just toggle.
        // The caret always toggles expansion (it stops propagation).
        const handleRowClick = () => {
            if (opensIndex) openDirectoryIndex(node.indexPath!)
            else onToggleDirectory(node)
        }

        return (
            <div role="treeitem" aria-expanded={isExpanded}>
                <div
                    role="button"
                    tabIndex={0}
                    className={rowClassName}
                    style={{ paddingLeft: indentLeft }}
                    data-active={isActive ? 'true' : undefined}
                    onClick={handleRowClick}
                    onKeyDown={handleKeyDown}
                >
                    <span
                        className="docs-nav-caret"
                        aria-hidden="true"
                        onClick={e => { e.stopPropagation(); onToggleDirectory(node) }}
                    >
                        <Caret open={isExpanded} size={11} />
                    </span>
                    <span className="docs-nav-label">{node.label}</span>
                    {node.indexPath && notedPaths?.has(node.indexPath) && <NoteMarker />}
                </div>
                {isExpanded && children.length > 0 && (
                    <div role="group">
                        {children.map(child => (
                            <TreeNode
                                key={child.path}
                                node={child}
                                depth={depth + 1}
                                activePath={activePath}
                                expandedPaths={expandedPaths}
                                notedPaths={notedPaths}
                                onToggleDirectory={onToggleDirectory}
                                onOpenPage={onOpenPage}
                            />
                        ))}
                    </div>
                )}
            </div>
        )
    }

    // Page node
    return (
        <div
            role="treeitem"
            tabIndex={0}
            className={rowClassName}
            style={{ paddingLeft: indentLeft }}
            data-active={isActive ? 'true' : undefined}
            onClick={() => onOpenPage(node)}
            onKeyDown={handleKeyDown}
        >
            <span className="docs-nav-bullet" aria-hidden="true" />
            <span className="docs-nav-label">{node.label}</span>
            {notedPaths?.has(node.path) && <NoteMarker />}
        </div>
    )
})

// ---------------------------------------------------------------------------
// DocsTree
// ---------------------------------------------------------------------------

export interface DocsTreeProps {
    roots: DocsTreeNode[]
    activePath: string | null
    onOpenPage: (node: DocsTreeNode) => void
    /** Repo-relative paths with a note, marked by a sticky-note glyph. */
    notedPaths?: Set<string>
}

/**
 * Collapsible navigation tree for the Developer Docs tool window.
 *
 * The tree arrives fully labeled and ordered from the main process. Pages
 * activate on click or keyboard, and the tree follows the active page.
 */
export function DocsTree({ roots, activePath, onOpenPage, notedPaths }: DocsTreeProps): React.JSX.Element {
    const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
    const treeRef = useRef<HTMLDivElement>(null)

    const handleToggleDirectory = useCallback(
        (node: DocsTreeNode) => {
            setExpandedPaths(prev => {
                const next = new Set(prev)
                if (next.has(node.path)) {
                    next.delete(node.path)
                } else {
                    next.add(node.path)
                }
                return next
            })
        },
        []
    )

    // Sync the tree to the open page: expand its ancestors and scroll it into view.
    useEffect(() => {
        if (!activePath) return
        setExpandedPaths(prev => {
            const next = new Set(prev)
            for (const path of ancestorPaths(activePath)) next.add(path)
            return next
        })
        const frame = requestAnimationFrame(() => {
            treeRef.current
                ?.querySelector<HTMLElement>('[data-active="true"]')
                ?.scrollIntoView({ block: 'nearest' })
        })
        return () => cancelAnimationFrame(frame)
    }, [activePath])

    return (
        <div role="tree" className="docs-nav-tree" ref={treeRef}>
            {roots.map(root => (
                <TreeNode
                    key={root.path}
                    node={root}
                    depth={0}
                    activePath={activePath}
                    expandedPaths={expandedPaths}
                    notedPaths={notedPaths}
                    onToggleDirectory={handleToggleDirectory}
                    onOpenPage={onOpenPage}
                />
            ))}
        </div>
    )
}
