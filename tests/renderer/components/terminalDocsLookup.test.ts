import { it, expect } from 'vitest'
import { selectionQualifiesForLookup } from '@renderer/components/terminalDocsLookup'

it('qualifies a one to three word selection', () => {
    expect(selectionQualifiesForLookup('roSGNode')).toBe(true)
    expect(selectionQualifiesForLookup('render thread')).toBe(true)
    expect(selectionQualifiesForLookup('three word term')).toBe(true)
})

it('rejects an empty or whitespace-only selection', () => {
    expect(selectionQualifiesForLookup('')).toBe(false)
    expect(selectionQualifiesForLookup('   \n\t ')).toBe(false)
})

it('rejects a selection longer than three words', () => {
    expect(selectionQualifiesForLookup('this is a full line of output')).toBe(false)
})

it('ignores surrounding and internal extra whitespace', () => {
    expect(selectionQualifiesForLookup('  roSGNode  ')).toBe(true)
    expect(selectionQualifiesForLookup('render\n   thread')).toBe(true)
})
