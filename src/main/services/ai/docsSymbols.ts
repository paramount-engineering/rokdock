/**
 * Builds a map of linkable documented symbols (Roku component/interface names,
 * camel/Pascal API names, and single-word component titles) to their docs page
 * paths, from the page-label list. The renderer uses it to auto-link symbol
 * references in assistant answers. The linkable-title rule is shared with the
 * renderer (see shared/docs/docSymbols).
 */
import { isLinkableTitle } from '../../../shared/docs/docSymbols'

export interface DocSymbolIndex {
    get(): Promise<Record<string, string>>
}

export function createDocSymbolIndex(listPageLabels: () => Promise<Array<[string, string]>>): DocSymbolIndex {
    let cached: Promise<Record<string, string>> | null = null
    async function build(): Promise<Record<string, string>> {
        const labels = await listPageLabels()
        const map: Record<string, string> = {}
        for (const [path, title] of labels) {
            if (isLinkableTitle(title) && !(title in map)) map[title] = path
        }
        return map
    }
    return {
        get() {
            if (cached === null) {
                cached = build()
                    .then(map => {
                        // An empty map means the docs tree was not ready when this built.
                        // Do not memoize it, so the next caller rebuilds once the tree loads
                        // instead of the session being stuck with no linkable symbols.
                        if (Object.keys(map).length === 0) cached = null
                        return map
                    })
                    .catch(err => { cached = null; throw err })
            }
            return cached
        },
    }
}
