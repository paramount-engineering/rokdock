/**
 * E2E: manually-added devices persist across restarts, independent of SSDP.
 *
 * Regression for a bug where adding a manual device WITH credentials (the Add
 * Device dialog calls addManual then setDeviceAuth) deleted the persisted manual
 * entry: setDeviceAuth removed it whenever a matching in-memory SSDP device
 * existed. A working SSDP scan rediscovered the device on the next launch and
 * masked the loss; when SSDP was failing the device vanished for good.
 *
 * Uses an unreachable IP so SSDP can never rediscover it, proving the entry
 * survives on persistence alone.
 */

import { test, expect } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { launchRokDockWithArgsAndUserData } from './helpers'

const UNREACHABLE_IP = '10.0.0.99'

test('a manually-added device with credentials survives a restart', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'rokdock-manualpersist-'))
    const configPath = path.join(userData, 'rokdock-config.json')

    // Launch 1: add a manual device exactly as the Add Device dialog does.
    const first = await launchRokDockWithArgsAndUserData([], userData)
    try {
        await first.mainWin.evaluate(async (ip) => {
            await window.rokdock.discovery.addManual(ip, 'Persisted Roku', true)
            await window.rokdock.store.setDeviceAuth(ip, 'rokudev', 'secret')
        }, UNREACHABLE_IP)
        await first.mainWin.waitForTimeout(500)

        // The manual entry must remain in the persisted store after setting auth.
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
        expect(config.manualDevices).toContainEqual({ ip: UNREACHABLE_IP, name: 'Persisted Roku' })
    } finally {
        await first.app.close()
    }

    // Launch 2: same userData (simulated restart). SSDP cannot reach the IP, so the
    // device can only reappear if it was persisted and restored.
    const second = await launchRokDockWithArgsAndUserData([], userData)
    try {
        await second.mainWin.waitForTimeout(500)
        const devices = await second.mainWin.evaluate(() => window.rokdock.discovery.getDevices())
        expect(devices.some((d) => d.ip === UNREACHABLE_IP)).toBe(true)
    } finally {
        await second.app.close()
        fs.rmSync(userData, { recursive: true, force: true })
    }
})
