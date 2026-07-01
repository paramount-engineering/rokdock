/**
 * Parse the input string as a JSON object, returning an empty object on any failure, empty
 * input, or a parsed value that is not a plain object (null, an array, or a primitive).
 * Callers treat the result as a Record, so a non-object parse must not slip through (`null`
 * in particular would throw on a later property access).
 */
export function safeJsonObject(input: string): Record<string, unknown> {
    try {
        const value = JSON.parse(input || '{}') as unknown
        return (value !== null && typeof value === 'object' && !Array.isArray(value)) ? value as Record<string, unknown> : {}
    } catch {
        return {}
    }
}
