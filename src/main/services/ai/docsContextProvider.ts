/**
 * RokDock-side context provider that grounds the assistant in the Roku docs via
 * on-demand pull only: search_docs returns scored chunk snippets, fetch_page
 * returns a full page (capped). Both degrade to an isError result on
 * timeout/abort/failure, so the chat never breaks.
 *
 * There is deliberately no per-turn push (retrieve()): a keyword guess against
 * the prompt was frequently irrelevant, and re-seeding every turn wasted tokens.
 * The agent decides when docs are needed and calls the tools itself.
 */
import type { ContextProvider, ToolDef, ToolResult } from '../../../ai-core/types'
import type { DocChunk } from '../docsRagIndex'

const TOOL_TIMEOUT_MS = 6000
const SEARCH_TOOL_K = 8
const FETCH_MAX_CHARS = 8000

interface DocsDeps {
    query(text: string, k?: number): Promise<DocChunk[]>
    getPage(path: string): Promise<{ markdown: string }>
}

/** Resolve to `fallback` if the promise does not settle within ms, or if the signal aborts. */
function withTimeout<T>(promise: Promise<T>, ms: number, signal: AbortSignal, fallback: T): Promise<T> {
    return new Promise<T>(resolve => {
        const timer = setTimeout(() => resolve(fallback), ms)
        const onAbort = (): void => { clearTimeout(timer); resolve(fallback) }
        signal.addEventListener('abort', onAbort, { once: true })
        promise.then(value => { clearTimeout(timer); signal.removeEventListener('abort', onAbort); resolve(value) },
               () => { clearTimeout(timer); signal.removeEventListener('abort', onAbort); resolve(fallback) })
    })
}

const SEARCH_DOCS: ToolDef = {
    name: 'search_docs',
    description: 'Search the Roku developer documentation for a query and return the most relevant page snippets, each with its repo-relative path.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search terms (API names, concepts).' } }, required: ['query'] },
}

const FETCH_PAGE: ToolDef = {
    name: 'fetch_page',
    description: 'Fetch the full markdown of a documentation page by its repo-relative path (as returned by search_docs).',
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'Repo-relative page path from a search_docs result.' } }, required: ['path'] },
}

export function createDocsContextProvider(deps: DocsDeps): ContextProvider {
    async function searchDocs(query: string, signal: AbortSignal): Promise<ToolResult> {
        const chunks = await withTimeout(deps.query(query, SEARCH_TOOL_K), TOOL_TIMEOUT_MS, signal, [] as DocChunk[])
        const hits = chunks.map(chunk => ({ path: chunk.path, title: chunk.title, heading: chunk.heading, snippet: chunk.text }))
        return { content: JSON.stringify(hits) }
    }
    async function fetchPage(path: string, signal: AbortSignal): Promise<ToolResult> {
        const page = await withTimeout(deps.getPage(path).then(pageResult => pageResult.markdown), TOOL_TIMEOUT_MS, signal, null as string | null)
        if (page === null) return { content: `No page found at ${path}`, isError: true }
        return { content: page.slice(0, FETCH_MAX_CHARS) }
    }
    return {
        name: 'roku-docs',
        tools(): ToolDef[] {
            return [SEARCH_DOCS, FETCH_PAGE]
        },
        async callTool(name: string, args: unknown, signal: AbortSignal): Promise<ToolResult> {
            const argsRecord = (args ?? {}) as Record<string, unknown>
            if (name === 'search_docs') {
                if (typeof argsRecord.query !== 'string' || !argsRecord.query.trim()) return { content: 'search_docs requires a non-empty query string.', isError: true }
                return searchDocs(argsRecord.query, signal)
            }
            if (name === 'fetch_page') {
                if (typeof argsRecord.path !== 'string' || !argsRecord.path.trim()) return { content: 'fetch_page requires a path string.', isError: true }
                return fetchPage(argsRecord.path, signal)
            }
            return { content: `Unknown tool: ${name}`, isError: true }
        },
    }
}
