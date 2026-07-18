/**
 * E2E proof that detected CLIs are presented as ordinary providers.
 *
 * Launches with ROKDOCK_E2E_CLIS=claude,codex so the app injects a fixed
 * detectClis stub at the composition root, bypassing the real PATH probe.
 * Verifies: detected CLIs appear in the Providers list, "Set active" moves the
 * Active badge, editing a CLI's model round-trips across a Settings close and
 * reopen, a CLI that is not on PATH can be added from the provider form, and no
 * CSP violations are raised.
 */
import { test, expect } from '@playwright/test'
import { launchRokDock, type LaunchedApp } from './helpers'

/** Opens the Settings dialog via the File menu and navigates to the AI tab. */
async function openAiSettings(mainWin: import('@playwright/test').Page): Promise<void> {
    await mainWin.getByRole('button', { name: 'File' }).click()
    await mainWin.getByRole('button', { name: /^Settings\.\.\./ }).click({ force: true })
    await mainWin.getByRole('button', { name: 'roBot (Beta)', exact: true }).click()
}

/** Closes the Settings dialog via the Cancel button. */
async function closeSettings(mainWin: import('@playwright/test').Page): Promise<void> {
    await mainWin.getByRole('button', { name: 'Cancel', exact: true }).click()
}

/** Sets a rokdock-select custom element's value and dispatches its change event. */
async function setProviderType(mainWin: import('@playwright/test').Page, value: string): Promise<void> {
    await mainWin.locator('rokdock-select').evaluate((el, selected) => {
        (el as unknown as { value: string }).value = selected
        el.dispatchEvent(new CustomEvent('rokdock-change', { detail: { value: selected }, bubbles: true }))
    }, value)
}

test.describe('Detected CLIs as providers', () => {
    let launched: LaunchedApp

    test.beforeEach(async () => {
        // Inject the fixed CLI list through process.env before launch.
        // launchWith() copies process.env at call time, so setting it here
        // causes ROKDOCK_E2E_CLIS to arrive in the app's env and trigger the
        // env-gated detectClis stub at the composition root.
        process.env.ROKDOCK_E2E_CLIS = 'claude,codex'
        launched = await launchRokDock()
    })

    test.afterEach(async () => {
        delete process.env.ROKDOCK_E2E_CLIS
        await launched.app.close()
    })

    test('Providers list includes the detected CLIs', async () => {
        const mainWin = launched.mainWin

        await openAiSettings(mainWin)

        // The single Providers section holds detected CLIs alongside any HTTP providers.
        await expect(mainWin.getByText('Providers', { exact: true })).toBeVisible({ timeout: 5000 })
        await expect(mainWin.getByText('Claude Code', { exact: true })).toBeVisible()
        await expect(mainWin.getByText('Codex', { exact: true })).toBeVisible()

        expect(launched.cspViolations).toHaveLength(0)
    })

    test('Set active moves the Active badge to the chosen CLI', async () => {
        const mainWin = launched.mainWin

        await openAiSettings(mainWin)

        // Neither CLI is active by default (no active profile is set in a fresh run).
        // Both "Set active" buttons must be present, one per detected CLI.
        await expect(mainWin.getByTestId('ai-cli-set-active')).toHaveCount(2)

        // Activate the first CLI (Claude Code, listed first in CLI_DEFINITIONS order).
        await mainWin.getByTestId('ai-cli-set-active').first().click()

        // Exactly one Active badge now appears among the CLI rows.
        await expect(mainWin.getByTestId('ai-cli-active-badge')).toHaveCount(1, { timeout: 5000 })

        // Only one "Set active" button remains (for Codex).
        await expect(mainWin.getByTestId('ai-cli-set-active')).toHaveCount(1)

        expect(launched.cspViolations).toHaveLength(0)
    })

    test('editing a CLI model round-trips after reopening Settings', async () => {
        const mainWin = launched.mainWin

        await openAiSettings(mainWin)

        // A CLI is configured through the same provider form as any provider. Open the
        // first CLI row's editor (Claude Code) via its edit pencil.
        await mainWin.getByTestId('ai-cli-edit').first().click()
        const model = mainWin.getByTestId('ai-model')
        await expect(model).toBeVisible({ timeout: 5000 })
        await model.fill('claude-opus-4-5')
        await mainWin.getByTestId('ai-add-profile').click()
        // The save closes the form; the "Add provider" button only renders when the form is
        // closed, so awaiting it confirms the save settled before we close Settings.
        await expect(mainWin.getByTestId('ai-show-add-form')).toBeVisible({ timeout: 5000 })

        // Close and reopen Settings, then reopen the editor to read the persisted value.
        await closeSettings(mainWin)
        await openAiSettings(mainWin)
        await mainWin.getByTestId('ai-cli-edit').first().click()
        await expect(mainWin.getByTestId('ai-model')).toHaveValue('claude-opus-4-5', { timeout: 5000 })

        expect(launched.cspViolations).toHaveLength(0)
    })

    test('a CLI that is not on PATH can be added from the provider form', async () => {
        const mainWin = launched.mainWin

        await openAiSettings(mainWin)

        // Only the two detected CLIs are listed; Gemini is not on the injected PATH.
        await expect(mainWin.getByTestId('ai-cli-set-active')).toHaveCount(2)

        // Add the Gemini CLI through the provider form by selecting its provider type.
        await mainWin.getByTestId('ai-show-add-form').click()
        await setProviderType(mainWin, 'cli:gemini')
        await mainWin.getByTestId('ai-add-profile').click()

        // The added CLI now appears as a third provider row.
        await expect(mainWin.getByTestId('ai-cli-set-active')).toHaveCount(3, { timeout: 5000 })
        await expect(mainWin.getByText('Gemini', { exact: true })).toBeVisible()

        expect(launched.cspViolations).toHaveLength(0)
    })

    test('removing a CLI drops it from the list', async () => {
        const mainWin = launched.mainWin

        await openAiSettings(mainWin)
        await expect(mainWin.getByTestId('ai-cli-set-active')).toHaveCount(2)

        // Remove the first CLI (Claude Code) and confirm the destructive dialog.
        await mainWin.getByTestId('ai-cli-remove').first().click()
        await mainWin.getByRole('button', { name: 'Remove', exact: true }).click()

        // Only Codex remains.
        await expect(mainWin.getByTestId('ai-cli-set-active')).toHaveCount(1, { timeout: 5000 })
        await expect(mainWin.getByText('Claude Code', { exact: true })).toHaveCount(0)

        expect(launched.cspViolations).toHaveLength(0)
    })
})
