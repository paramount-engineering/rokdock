/**
 * Shared HTML escaping utility.
 *
 * Escapes the characters that are meaningful in HTML attribute values and
 * element content: &, <, >, and ". The function accepts unknown so callers
 * do not need to convert before passing; null and undefined become an empty
 * string.
 */
export function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}
