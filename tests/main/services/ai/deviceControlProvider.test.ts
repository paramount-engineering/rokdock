import { describe, it, expect, vi } from 'vitest'
import type { DeviceInfo } from '@shared/device'
import type { EcpService } from '@main/services/ecp'
import { createDeviceControlProvider } from '@main/services/ai/deviceControlProvider'

const SIGNAL = new AbortController().signal

function device(over: Partial<DeviceInfo> = {}): DeviceInfo {
    return {
        id: 'manual-192.168.1.5', ip: '192.168.1.5', port: 8060, name: 'Living Room',
        codename: '', model: 'Roku Ultra', modelNumber: '4800X', serialNumber: 'SERIAL123',
        softwareVersion: '', location: '', lastSeen: 0, manual: true, hasAuth: false,
        discoveredOnNetwork: true, activeAppId: '12', activeAppName: 'Netflix', reachable: true,
        ...over,
    }
}

function mockEcp(): EcpService {
    return {
        keypress: vi.fn(async () => {}),
        keydown: vi.fn(async () => {}),
        keyup: vi.fn(async () => {}),
        sendText: vi.fn(async () => {}),
        launchApp: vi.fn(async () => {}),
        exitApp: vi.fn(async () => {}),
        launchDeeplink: vi.fn(async () => {}),
        sendInput: vi.fn(async () => {}),
        queryActiveApp: vi.fn(async () => ({ id: '12', name: 'Netflix' })),
        queryMediaPlayer: vi.fn(async () => ({ state: 'play' as const, position: 1000, duration: 5000 })),
        queryApps: vi.fn(async () => [{ id: '12', name: 'Netflix' }, { id: '13', name: 'YouTube' }]),
        ping: vi.fn(async () => {}),
    } as unknown as EcpService
}

function make(opts: { devices?: DeviceInfo[]; activeIp?: string | null; ecp?: EcpService; captureScreenshot?: (ip: string) => Promise<{ ok: boolean; error?: string; viaHdmiCapture?: boolean }> } = {}) {
    const ecp = opts.ecp ?? mockEcp()
    const captureScreenshot = opts.captureScreenshot ?? vi.fn(async () => ({ ok: true }))
    const provider = createDeviceControlProvider({
        ecp,
        listDevices: () => opts.devices ?? [device()],
        getActiveDeviceIp: () => opts.activeIp ?? null,
        captureScreenshot,
    })
    return { provider, ecp, captureScreenshot }
}

const allow = async (): Promise<boolean> => true
const deny = async (): Promise<boolean> => false

describe('deviceControlProvider tool specs', () => {
    it('exposes the read and action tools', () => {
        const names = make().provider.tools!().map(tool => tool.name).sort()
        expect(names).toEqual([
            'capture_screenshot', 'get_active_app', 'get_media_state', 'launch_channel', 'list_devices',
            'list_installed_channels', 'open_deeplink', 'press_remote_key', 'type_text',
        ])
    })
})

describe('list_devices', () => {
    it('returns names, model, reachability but never IP or serial', async () => {
        const { provider } = make({ devices: [device({ name: 'Bedroom', ip: '10.0.0.9', serialNumber: 'ABC' })] })
        const result = await provider.callTool!('list_devices', {}, SIGNAL)
        expect(result.content).toContain('Bedroom')
        expect(result.content).not.toContain('10.0.0.9')
        expect(result.content).not.toContain('ABC')
    })
})

describe('device resolution', () => {
    it('defaults to the selected (active) device', async () => {
        const devices = [device({ name: 'A', ip: '1.1.1.1' }), device({ name: 'B', ip: '2.2.2.2' })]
        const { provider, ecp } = make({ devices, activeIp: '2.2.2.2' })
        await provider.callTool!('get_active_app', {}, SIGNAL)
        expect((ecp.queryActiveApp as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('2.2.2.2')
    })

    it('errors when multiple devices exist and none is selected', async () => {
        const devices = [device({ name: 'A', ip: '1.1.1.1' }), device({ name: 'B', ip: '2.2.2.2' })]
        const result = await make({ devices }).provider.callTool!('get_active_app', {}, SIGNAL)
        expect(result.isError).toBe(true)
        expect(result.content).toContain('Specify one by name')
    })

    it('resolves an explicit device by name (case-insensitive)', async () => {
        const devices = [device({ name: 'A', ip: '1.1.1.1' }), device({ name: 'Bedroom', ip: '2.2.2.2' })]
        const { provider, ecp } = make({ devices })
        await provider.callTool!('get_active_app', { device: 'bedroom' }, SIGNAL)
        expect((ecp.queryActiveApp as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('2.2.2.2')
    })

    it('errors on an ambiguous substring rather than guessing a device', async () => {
        const devices = [device({ name: 'Living Room', ip: '1.1.1.1' }), device({ name: 'Living Room 2', ip: '2.2.2.2' })]
        const result = await make({ devices }).provider.callTool!('get_active_app', { device: 'Living' }, SIGNAL)
        expect(result.isError).toBe(true)
        expect(result.content).toContain('ambiguous')
    })
})

describe('press_remote_key', () => {
    it('presses the key count times when confirmed', async () => {
        const { provider, ecp } = make()
        const result = await provider.callTool!('press_remote_key', { key: 'down', count: 3 }, SIGNAL, { confirm: allow })
        expect(result.isError).toBeFalsy()
        expect((ecp.keypress as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(3)
        expect((ecp.keypress as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('192.168.1.5', 'Down')
    })

    it('does nothing and reports declined when the user denies', async () => {
        const { provider, ecp } = make()
        const result = await provider.callTool!('press_remote_key', { key: 'Home' }, SIGNAL, { confirm: deny })
        expect(result.isError).toBe(true)
        expect((ecp.keypress as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
    })

    it('denies when no confirm hook is available (fail-safe)', async () => {
        const { provider, ecp } = make()
        const result = await provider.callTool!('press_remote_key', { key: 'Home' }, SIGNAL)
        expect(result.isError).toBe(true)
        expect((ecp.keypress as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
    })

    it('rejects an unknown key', async () => {
        const { provider, ecp } = make()
        const result = await provider.callTool!('press_remote_key', { key: 'Nope' }, SIGNAL, { confirm: allow })
        expect(result.isError).toBe(true)
        expect((ecp.keypress as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
    })
})

describe('type_text', () => {
    it('sends text when confirmed', async () => {
        const { provider, ecp } = make()
        await provider.callTool!('type_text', { text: 'hello' }, SIGNAL, { confirm: allow })
        expect((ecp.sendText as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('192.168.1.5', 'hello')
    })
})

describe('launch_channel', () => {
    it('launches a numeric app id directly (no channel lookup)', async () => {
        const { provider, ecp } = make()
        await provider.callTool!('launch_channel', { channel: '551012' }, SIGNAL, { confirm: allow })
        expect((ecp.launchApp as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('192.168.1.5', '551012')
        expect((ecp.queryApps as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
    })

    it('resolves a channel name to its id via queryApps', async () => {
        const { provider, ecp } = make()
        await provider.callTool!('launch_channel', { channel: 'youtube' }, SIGNAL, { confirm: allow })
        expect((ecp.launchApp as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('192.168.1.5', '13')
    })

    it('relaunches a running STORE app via a Home keypress then launch (exit-app cannot terminate it)', async () => {
        vi.useFakeTimers()
        try {
            const ask = vi.fn(async () => 'Relaunch')
            const { provider, ecp } = make() // queryActiveApp mock returns Netflix (id 12), which is active
            const resultPromise = provider.callTool!('launch_channel', { channel: 'netflix' }, SIGNAL, { ask, confirm: allow })
            await vi.runAllTimersAsync() // let the post-Home settle delay elapse
            const result = await resultPromise
            expect(ask).toHaveBeenCalled()
            // exit-app only terminates dev-account apps, so a store app is backgrounded with Home first.
            expect((ecp.keypress as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('192.168.1.5', 'Home')
            expect((ecp.exitApp as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
            expect((ecp.launchApp as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('192.168.1.5', '12')
            expect(result.content).toContain('Relaunched')
        } finally {
            vi.useRealTimers()
        }
    })

    it('relaunches directly without the "leave it running" question when relaunch is set', async () => {
        vi.useFakeTimers()
        try {
            const ask = vi.fn(async () => 'Relaunch')
            const confirm = vi.fn(async () => true)
            const { provider, ecp } = make() // Netflix (id 12) is the active app
            const resultPromise = provider.callTool!('launch_channel', { channel: 'netflix', relaunch: true }, SIGNAL, { ask, confirm })
            await vi.runAllTimersAsync()
            const result = await resultPromise
            expect(ask).not.toHaveBeenCalled() // no redundant relaunch-or-leave choice
            expect(confirm).toHaveBeenCalled() // still gated by the standard device-control confirm
            expect((ecp.keypress as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('192.168.1.5', 'Home')
            expect((ecp.launchApp as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('192.168.1.5', '12')
            expect(result.content).toContain('Relaunched')
        } finally {
            vi.useRealTimers()
        }
    })

    it('relaunches a running DEV channel via exit-app then launch (it can be terminated)', async () => {
        const ask = vi.fn(async () => 'Relaunch')
        const ecp = mockEcp()
        ;(ecp.queryActiveApp as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'dev', name: 'My Sideloaded App' })
        ;(ecp.queryApps as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'dev', name: 'My Sideloaded App' }])
        const { provider } = make({ ecp })
        const result = await provider.callTool!('launch_channel', { channel: 'dev' }, SIGNAL, { ask, confirm: allow })
        expect((ecp.exitApp as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('192.168.1.5', 'dev')
        expect((ecp.keypress as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
        expect((ecp.launchApp as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('192.168.1.5', 'dev')
        expect(result.content).toContain('Relaunched')
    })

    it('skips the relaunch-or-leave question and relaunches when confirmations are turned off', async () => {
        vi.useFakeTimers()
        try {
            const ask = vi.fn(async () => 'Relaunch')
            const confirm = vi.fn(async () => true)
            const { provider, ecp } = make() // Netflix (id 12) is the active app
            const resultPromise = provider.callTool!('launch_channel', { channel: 'netflix' }, SIGNAL, { ask, confirm, confirmationsEnabled: false })
            await vi.runAllTimersAsync()
            const result = await resultPromise
            expect(ask).not.toHaveBeenCalled() // no prompt when confirmations are off
            expect((ecp.keypress as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('192.168.1.5', 'Home')
            expect((ecp.launchApp as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('192.168.1.5', '12')
            expect(result.content).toContain('Relaunched')
        } finally {
            vi.useRealTimers()
        }
    })

    it('leaves a running channel alone when the user declines the relaunch', async () => {
        const ask = vi.fn(async () => 'Leave it running')
        const { provider, ecp } = make()
        const result = await provider.callTool!('launch_channel', { channel: 'netflix' }, SIGNAL, { ask, confirm: allow })
        expect((ecp.launchApp as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
        expect(result.content).toContain('Left')
    })

    it('launches a non-numeric app id (e.g. the sideloaded "dev" channel) by id', async () => {
        const ecp = mockEcp()
        ;(ecp.queryApps as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'dev', name: 'My Sideloaded App' }])
        const { provider } = make({ ecp })
        await provider.callTool!('launch_channel', { channel: 'dev' }, SIGNAL, { confirm: allow })
        expect((ecp.launchApp as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('192.168.1.5', 'dev')
    })
})

describe('capture_screenshot', () => {
    it('captures on the resolved device and reports the preview', async () => {
        const captureScreenshot = vi.fn(async () => ({ ok: true }))
        const result = await make({ captureScreenshot }).provider.callTool!('capture_screenshot', {}, SIGNAL)
        expect(captureScreenshot).toHaveBeenCalledWith('192.168.1.5')
        expect(result.isError).toBeFalsy()
        expect(result.content).toContain('chat')
    })

    it('surfaces the capture error (e.g. dev channel not active)', async () => {
        const captureScreenshot = vi.fn(async () => ({ ok: false, error: 'Screenshot is only available when the active app is "dev".' }))
        const result = await make({ captureScreenshot }).provider.callTool!('capture_screenshot', {}, SIGNAL)
        expect(result.isError).toBe(true)
        expect(result.content).toContain('dev')
    })

    it('notes the HDMI-capture caveat when the native screenshot fell back', async () => {
        const captureScreenshot = vi.fn(async () => ({ ok: true, viaHdmiCapture: true }))
        const result = await make({ captureScreenshot }).provider.callTool!('capture_screenshot', {}, SIGNAL)
        expect(result.isError).toBeFalsy()
        expect(result.content).toContain('HDMI capture device')
    })
})

describe('active device context', () => {
    it('tells the model the selected device so it need not ask', async () => {
        const { provider } = make({ activeIp: '192.168.1.5' })
        const blocks = await provider.retrieve!({ messages: [] }, SIGNAL)
        expect(blocks).toHaveLength(1)
        expect(blocks[0].text).toContain('Living Room')
    })

    it('provides no context when no device is selected', async () => {
        const { provider } = make()
        expect(await provider.retrieve!({ messages: [] }, SIGNAL)).toEqual([])
    })
})

describe('abort', () => {
    it('does not send keypresses when the signal is already aborted', async () => {
        const controller = new AbortController()
        controller.abort()
        const { provider, ecp } = make()
        const result = await provider.callTool!('press_remote_key', { key: 'Down', count: 5 }, controller.signal, { confirm: allow })
        expect(result.isError).toBe(true)
        expect((ecp.keypress as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
    })
})

describe('list_installed_channels', () => {
    it('returns channel names and ids', async () => {
        const result = await make().provider.callTool!('list_installed_channels', {}, SIGNAL)
        const parsed = JSON.parse(result.content)
        expect(parsed.channels).toEqual([{ id: '12', name: 'Netflix' }, { id: '13', name: 'YouTube' }])
    })
})

describe('open_deeplink', () => {
    it('launches a deeplink with contentId and mediaType when confirmed', async () => {
        const { provider, ecp } = make()
        await provider.callTool!('open_deeplink', { channel: '12', contentId: 'abc', mediaType: 'movie' }, SIGNAL, { confirm: allow })
        expect((ecp.launchDeeplink as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('192.168.1.5', '12', { contentId: 'abc', mediaType: 'movie' })
    })
})
