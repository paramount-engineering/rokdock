import { describe, it, expect, beforeEach } from 'vitest'
import { resolveAugmentedPath, resetAugmentedPathCache } from '@main/services/ai/shellPath'

beforeEach(() => resetAugmentedPathCache())

describe('resolveAugmentedPath', () => {
    it('returns the inherited PATH unchanged on Windows', async () => {
        const result = await resolveAugmentedPath({ platform: 'win32', env: { PATH: 'C:\\a;C:\\b' } })
        expect(result).toBe('C:\\a;C:\\b')
    })

    it('merges login-shell PATH, inherited PATH, and known dirs on macOS, deduped', async () => {
        const result = await resolveAugmentedPath({
            platform: 'darwin',
            env: { PATH: '/usr/bin', HOME: '/Users/x' },
            readLoginShellPath: async () => '/opt/homebrew/bin:/usr/bin',
        })
        const dirs = result.split(':')
        expect(dirs).toContain('/opt/homebrew/bin')
        expect(dirs).toContain('/usr/bin')
        expect(dirs).toContain('/Users/x/.local/bin')
        expect(new Set(dirs).size).toBe(dirs.length)
    })

    it('falls back to inherited PATH plus known dirs when the shell read fails', async () => {
        const result = await resolveAugmentedPath({
            platform: 'linux',
            env: { PATH: '/usr/bin', HOME: '/home/x' },
            readLoginShellPath: async () => null,
        })
        expect(result.split(':')).toEqual(expect.arrayContaining(['/usr/bin', '/usr/local/bin']))
    })

    it('caches the resolved value across calls', async () => {
        let calls = 0
        const read = async (): Promise<string> => { calls++; return '/opt/homebrew/bin' }
        await resolveAugmentedPath({ platform: 'darwin', env: { PATH: '/usr/bin' }, readLoginShellPath: read })
        await resolveAugmentedPath({ platform: 'darwin', env: { PATH: '/usr/bin' }, readLoginShellPath: read })
        expect(calls).toBe(1)
    })
})
