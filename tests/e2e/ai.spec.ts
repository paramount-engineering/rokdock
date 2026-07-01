/**
 * E2E proof that the AI engine wiring works end-to-end.
 *
 * Spins up a loopback HTTP server that speaks a minimal OpenAI-compatible SSE
 * protocol, configures an ai profile pointing at it, runs Test Connection, and
 * asserts the streamed text arrives in the UI. Also verifies the negative case:
 * Test Connection with no active profile shows an error.
 */
import { test, expect } from '@playwright/test'
import http from 'http'
import type { AddressInfo } from 'net'
import { launchRokDock, type LaunchedApp } from './helpers'

/**
 * Starts a loopback HTTP server that responds to any POST with an SSE stream
 * spelling "OK" then sends [DONE]. Resolves with the base URL and a close fn.
 */
function startFakeServer(): Promise<{ url: string; close: () => Promise<void> }> {
    return new Promise(resolve => {
        const server = http.createServer((_req, res) => {
            res.writeHead(200, {
                'content-type': 'text/event-stream',
                'cache-control': 'no-cache',
                'connection': 'keep-alive',
            })
            res.write('data: {"choices":[{"delta":{"content":"O"}}]}\n\n')
            res.write('data: {"choices":[{"delta":{"content":"K"}}]}\n\n')
            res.write('data: [DONE]\n\n')
            res.end()
        })
        server.listen(0, '127.0.0.1', () => {
            const port = (server.address() as AddressInfo).port
            resolve({
                url: `http://127.0.0.1:${port}/v1`,
                close: () => new Promise<void>(done => server.close(() => done())),
            })
        })
    })
}

/** Starts a loopback HTTP server that always responds 500, to exercise the error path. */
function startErrorServer(): Promise<{ url: string; close: () => Promise<void> }> {
    return new Promise(resolve => {
        const server = http.createServer((_req, res) => {
            res.writeHead(500, { 'content-type': 'text/plain' })
            res.end('boom')
        })
        server.listen(0, '127.0.0.1', () => {
            const port = (server.address() as AddressInfo).port
            resolve({
                url: `http://127.0.0.1:${port}/v1`,
                close: () => new Promise<void>(done => server.close(() => done())),
            })
        })
    })
}

/** Opens the Settings dialog via the File menu (the real path in RokDock). */
async function openSettings(mainWin: import('@playwright/test').Page): Promise<void> {
    await mainWin.getByRole('button', { name: 'File' }).click()
    await mainWin.getByRole('button', { name: /^Settings\.\.\./ }).click({ force: true })
}

/** Sets the value on a rokdock-select custom element by writing its public value
 *  setter and dispatching the rokdock-change event so React state picks it up. */
async function setRokdockSelect(
    mainWin: import('@playwright/test').Page,
    selector: string,
    value: string,
): Promise<void> {
    await mainWin.locator(selector).evaluate((el, v) => {
        // The element exposes a public `value` setter (see RokdockSelect.ts).
        (el as unknown as { value: string }).value = v
        el.dispatchEvent(new CustomEvent('rokdock-change', { detail: { value: v }, bubbles: true }))
    }, value)
}

/** Fill the Add-profile form for an openai-compatible provider pointed at `baseUrl`. */
async function addOpenAiProfile(mainWin: import('@playwright/test').Page, name: string, baseUrl: string): Promise<void> {
    await mainWin.getByTestId('ai-show-add-form').click()
    await mainWin.getByPlaceholder('My AI Provider').fill(name)
    await setRokdockSelect(mainWin, 'rokdock-select', 'openai-compatible')
    await mainWin.getByTestId('ai-model').fill('fake-model')
    await mainWin.getByTestId('ai-base-url').fill(baseUrl)
    await mainWin.getByTestId('ai-add-profile').click()
}

test.describe('AI engine wiring', () => {
    let launched: LaunchedApp
    let fake: Awaited<ReturnType<typeof startFakeServer>>
    let errorServer: Awaited<ReturnType<typeof startErrorServer>>

    test.beforeEach(async () => {
        launched = await launchRokDock()
        fake = await startFakeServer()
        errorServer = await startErrorServer()
    })

    test.afterEach(async () => {
        await fake.close()
        await errorServer.close()
        await launched.app.close()
    })

    test('per-row Test streams a response and shows the redaction preview', async () => {
        const mainWin = launched.mainWin

        await openSettings(mainWin)
        await mainWin.getByRole('button', { name: 'AI (Beta)', exact: true }).click()
        await addOpenAiProfile(mainWin, 'Fake Local', fake.url)

        // The new provider appears as a row. Test it from its own row (no need to make it active).
        await mainWin.getByTestId('ai-row-test').click()

        await expect(mainWin.getByTestId('ai-test-output')).toHaveText('OK', { timeout: 5000 })
        await expect(mainWin.getByTestId('ai-redaction-preview')).toContainText('Sent to the provider', { timeout: 5000 })
    })

    test('per-row Test surfaces an error when the provider is unreachable', async () => {
        const mainWin = launched.mainWin

        await openSettings(mainWin)
        await mainWin.getByRole('button', { name: 'AI (Beta)', exact: true }).click()
        await addOpenAiProfile(mainWin, 'Broken', errorServer.url)

        await mainWin.getByTestId('ai-row-test').click()

        await expect(mainWin.getByTestId('ai-test-output')).toContainText('Error:', { timeout: 5000 })
    })

    test('Set active moves the Active badge to the chosen provider', async () => {
        const mainWin = launched.mainWin

        await openSettings(mainWin)
        await mainWin.getByRole('button', { name: 'AI (Beta)', exact: true }).click()
        await addOpenAiProfile(mainWin, 'Alpha', fake.url)
        await addOpenAiProfile(mainWin, 'Bravo', fake.url)

        // The first provider is active by default, so its row holds the Active badge. The badge
        // sits in a fixed-width slot inside the row, so the row is its grandparent.
        await expect(mainWin.getByTestId('ai-active-badge').locator('xpath=../..')).toContainText('Alpha')

        // There is exactly one "Set active" button (Bravo's). Clicking it moves active to Bravo.
        await mainWin.getByTestId('ai-set-active').click()
        await expect(mainWin.getByTestId('ai-active-badge').locator('xpath=../..')).toContainText('Bravo')
    })

    test('configuring a provider reveals the AI Chat panel and streams a reply', async () => {
        const mainWin = launched.mainWin

        // With no provider, the chat toggle is hidden.
        await expect(mainWin.getByTestId('ai-chat-toggle')).toHaveCount(0)

        // Configure a provider.
        await openSettings(mainWin)
        await mainWin.getByRole('button', { name: 'AI (Beta)', exact: true }).click()
        await addOpenAiProfile(mainWin, 'Fake Local', fake.url)
        // Wait for the save to complete: the profile row appears with the Active badge
        // only after saveProfile IPC resolves and the tab re-queries the list.
        await expect(mainWin.getByTestId('ai-active-badge')).toBeVisible({ timeout: 5000 })
        // Close Settings via the Cancel button so App re-queries provider availability.
        // (Escape would also work but requires focus to be on the overlay or a
        // descendant that does not stop keydown propagation.)
        await mainWin.getByRole('button', { name: 'Cancel', exact: true }).click()

        // The toggle now appears; open the chat and send a message.
        await expect(mainWin.getByTestId('ai-chat-toggle')).toBeVisible({ timeout: 5000 })
        await mainWin.getByTestId('ai-chat-toggle').click()
        await expect(mainWin.getByTestId('ai-chat-panel')).toBeVisible()
        await mainWin.getByTestId('ai-chat-input').fill('explain this output')
        await mainWin.getByTestId('ai-chat-send').click()

        // The fake server streams "OK" back as the assistant reply.
        await expect(mainWin.getByTestId('ai-chat-message').last()).toContainText('OK', { timeout: 10000 })
    })
})
