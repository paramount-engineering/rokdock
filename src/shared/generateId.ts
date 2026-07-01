/**
 * Generates a short, opaque id for in-memory or UI items (editor tab ids,
 * list-row keys, imported deeplink entries). Collision-resistant enough to
 * distinguish items created in the same session. Not cryptographically secure
 * and not stable across reloads; never use it where a durable or secure id is
 * required.
 */
export function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}
