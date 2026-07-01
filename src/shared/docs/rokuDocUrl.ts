/**
 * Derives the canonical developer.roku.com URL for a given repo-relative docs path.
 *
 * The Roku developer docs repo mirrors at developer.roku.com with the path intact.
 * This is best-effort: the .md path form is what developer.roku.com serves natively.
 * ReadMe slug-disambiguated URLs are not derivable from the repo path, but the path
 * URL resolves to the correct page in practice.
 */

const ROKU_BASE = 'https://developer.roku.com/'
const ROKU_DOCS_HOME = ROKU_BASE + 'docs'

/**
 * Given a repo-relative path like `docs/references/scenegraph/xml-elements/script.md`,
 * returns the canonical developer.roku.com URL for that page.
 *
 * Falls back to the docs home when the path is absent or does not start with `docs/`.
 */
export function rokuDocUrl(repoPath: string | null | undefined): string {
    if (repoPath && repoPath.startsWith('docs/')) {
        return ROKU_BASE + repoPath
    }
    return ROKU_DOCS_HOME
}
