import { it, expect } from 'vitest'
import { setNoteInMap } from '@renderer/components/docs/useDocsNotes'

it('setNoteInMap sets a note and returns a new map', () => {
    const original: Record<string, string> = {}
    const result = setNoteInMap(original, 'docs/foo.md', 'hello')
    expect(result['docs/foo.md']).toBe('hello')
    expect(result).not.toBe(original)
})

it('setNoteInMap updates an existing note', () => {
    const map = setNoteInMap({}, 'docs/foo.md', 'hello')
    const updated = setNoteInMap(map, 'docs/foo.md', 'world')
    expect(updated['docs/foo.md']).toBe('world')
})

it('setNoteInMap deletes the key when text is empty string', () => {
    const map = setNoteInMap({}, 'docs/foo.md', 'hello')
    const cleared = setNoteInMap(map, 'docs/foo.md', '')
    expect('docs/foo.md' in cleared).toBe(false)
})

it('setNoteInMap deletes the key when text is whitespace only', () => {
    const map = setNoteInMap({}, 'docs/foo.md', 'hello')
    const cleared = setNoteInMap(map, 'docs/foo.md', '   ')
    expect('docs/foo.md' in cleared).toBe(false)
})

it('setNoteInMap does not mutate the input map', () => {
    const original = { 'docs/foo.md': 'original' }
    setNoteInMap(original, 'docs/foo.md', 'new value')
    expect(original['docs/foo.md']).toBe('original')
})
