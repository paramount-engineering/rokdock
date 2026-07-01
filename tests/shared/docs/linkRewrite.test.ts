import { describe, it, expect } from 'vitest'
import { resolveDocLink } from '@shared/docs/linkRewrite'

const slugIndex = { 'release-notes': 'docs/DEVELOPER/release-notes/index.md', 'deep-linking': 'docs/DEVELOPER/discovery/implementing-deep-linking.md' }
const currentPath = 'docs/DEVELOPER/dev-tools/external-control-api.md'

it('resolves a doc: slug to an internal path', () => {
    expect(resolveDocLink('doc:release-notes', slugIndex, currentPath))
        .toEqual({ kind: 'internal', path: 'docs/DEVELOPER/release-notes/index.md' })
})
it('keeps the anchor', () => {
    expect(resolveDocLink('doc:release-notes#roku-os-8', slugIndex, currentPath))
        .toEqual({ kind: 'internal', path: 'docs/DEVELOPER/release-notes/index.md', anchor: 'roku-os-8' })
})
it('resolves a relative .md link against the current directory', () => {
    expect(resolveDocLink('../discovery/implementing-deep-linking.md', slugIndex, currentPath))
        .toEqual({ kind: 'internal', path: 'docs/DEVELOPER/discovery/implementing-deep-linking.md' })
})
it('flags a dead Confluence link', () => {
    expect(resolveDocLink('SomePage_12345.html', slugIndex, currentPath)).toEqual({ kind: 'dead' })
})
it('flags a prefixed-path dead Confluence link', () => {
    expect(resolveDocLink('../legacy/SomePage_12345.html', slugIndex, currentPath)).toEqual({ kind: 'dead' })
})
it('passes through external https links', () => {
    expect(resolveDocLink('https://developer.roku.com/x', slugIndex, currentPath))
        .toEqual({ kind: 'external', href: 'https://developer.roku.com/x' })
})
it('returns dead for an unresolvable doc: slug', () => {
    expect(resolveDocLink('doc:nope', slugIndex, currentPath)).toEqual({ kind: 'dead' })
})
