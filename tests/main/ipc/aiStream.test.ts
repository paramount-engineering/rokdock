import { describe, it, expect } from 'vitest'
import { resolveSources } from '@main/ipc/handlers/ai'

describe('resolveSources', () => {
    const labels: Array<[string, string]> = [['SceneGraph/Node.md', 'Node'], ['x.md', 'X']]
    it('maps de-duped fetch paths to {path,title}', () => {
        expect(resolveSources(['SceneGraph/Node.md', 'SceneGraph/Node.md'], labels)).toEqual([{ path: 'SceneGraph/Node.md', title: 'Node' }])
    })
    it('falls back to the path when no label exists', () => {
        expect(resolveSources(['unknown.md'], labels)).toEqual([{ path: 'unknown.md', title: 'unknown.md' }])
    })
})
