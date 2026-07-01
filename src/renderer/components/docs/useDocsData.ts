import { useState, useEffect, useCallback } from 'react'
import type { DocsTree, DocsPage, WhatsNewResult, DocsSearchResult } from '@shared/docs/types'

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface DocsDataHook {
    tree: DocsTree | null
    treeError: string | null
    loadingTree: boolean
    loadPage: (path: string) => Promise<{ page?: DocsPage; error?: string }>
    loadWhatsNew: (since: string) => Promise<{ result?: WhatsNewResult; error?: string }>
    searchDocs: (query: string) => Promise<{ results?: DocsSearchResult[]; error?: string }>
}

export function useDocsData(): DocsDataHook {
    const [tree, setTree] = useState<DocsTree | null>(null)
    const [treeError, setTreeError] = useState<string | null>(null)
    const [loadingTree, setLoadingTree] = useState(true)

    useEffect(() => {
        setLoadingTree(true)
        window.rokdock.docs.getTree()
            .then((result: DocsTree) => {
                setTree(result)
                setTreeError(null)
            })
            .catch((err: unknown) => {
                setTreeError(err instanceof Error ? err.message : String(err))
            })
            .finally(() => {
                setLoadingTree(false)
            })
    }, [])

    const loadPage = useCallback(
        async (path: string): Promise<{ page?: DocsPage; error?: string }> => {
            try {
                const page = await window.rokdock.docs.getPage(path)
                return { page }
            } catch (err: unknown) {
                return { error: err instanceof Error ? err.message : String(err) }
            }
        },
        []
    )

    const loadWhatsNew = useCallback(
        async (since: string): Promise<{ result?: WhatsNewResult; error?: string }> => {
            try {
                const result = await window.rokdock.docs.getWhatsNew(since)
                return { result }
            } catch (err: unknown) {
                return { error: err instanceof Error ? err.message : String(err) }
            }
        },
        []
    )

    const searchDocs = useCallback(
        async (query: string): Promise<{ results?: DocsSearchResult[]; error?: string }> => {
            try {
                const results = await window.rokdock.docs.search(query)
                return { results }
            } catch (err: unknown) {
                return { error: err instanceof Error ? err.message : String(err) }
            }
        },
        []
    )

    return { tree, treeError, loadingTree, loadPage, loadWhatsNew, searchDocs }
}
