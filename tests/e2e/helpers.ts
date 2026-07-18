/**
 * Shared Playwright-Electron helpers for the E2E specs.
 *
 * Centralizes launching the built RokDock app and capturing fatal main-process
 * stderr, so each spec does not repeat the launch recipe and error-capture wiring.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
import { _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { TOOL_WINDOW_COMMAND_CHANNEL } from '../../src/shared/toolWindowCommands'

// Playwright's test runner transforms TS to CJS, so __dirname and require are
// available here. require() resolves the electron executable path, which
// electron's package.json exports as the module's main value. This file lives at
// tests/e2e/, so the repo root (and node_modules) is two levels up.
const electronExe: string = require(
    path.join(__dirname, '..', '..', 'node_modules', 'electron')
) as string

/** A launched app handle plus the live main window and captured fatal errors. */
export interface LaunchedApp {
    app: ElectronApplication
    mainWin: Page
    /** Main-process stderr lines that matched a fatal pattern. Mutated as they arrive. */
    mainErrors: string[]
    /** Renderer console messages that matched a CSP-violation pattern, across all windows. Mutated as they arrive. */
    cspViolations: string[]
}

/**
 * Launches the built RokDock app for E2E and starts capturing fatal main-process
 * stderr (ReferenceError, Uncaught Exception, etc.) into the returned mainErrors
 * array. Strips ELECTRON_RUN_AS_NODE so the binary runs as Electron, not plain
 * Node (with the flag set the app crashes immediately at app.commandLine).
 *
 * @returns The Electron application, its first (main) window, and the live error list.
 */
export async function launchRokDock(): Promise<LaunchedApp> {
    return launchWith([])
}

/**
 * Launches the built RokDock app with extra CLI args appended (e.g. a standalone
 * tool launch: `--tool json <path>`). For a `--tool` launch the dock never opens,
 * so the returned mainWin (app.firstWindow()) is the requested tool window.
 *
 * @param extraArgs - Args appended after the standard launch args.
 * @returns The Electron application, its first window, and the live error lists.
 */
export async function launchRokDockWithArgs(extraArgs: string[]): Promise<LaunchedApp> {
    return launchWith(extraArgs)
}

/**
 * Launches with extra args against a caller-supplied userData dir, so multiple
 * launches share persisted state (used to test session persistence across restarts).
 *
 * @param extraArgs - Args appended after the standard launch args.
 * @param userDataDir - A userData dir to reuse across launches.
 */
export async function launchRokDockWithArgsAndUserData(extraArgs: string[], userDataDir: string): Promise<LaunchedApp> {
    return launchWith(extraArgs, userDataDir)
}

/**
 * Shared launch + listener wiring used by both public launchers. Builds the
 * isolated env and userData dir, launches Electron with the standard args plus
 * any extras, and attaches the fatal-stderr and CSP-violation listeners.
 *
 * @param extraArgs - Args appended after the standard launch args.
 * @param userDataDir - Optional caller-supplied userData dir. When omitted, a fresh
 *   throwaway dir is created so each call is isolated by default. Pass a dir to
 *   share persisted state across multiple launches in a single test.
 */
async function launchWith(extraArgs: string[], userDataDir?: string): Promise<LaunchedApp> {
    // Copy env and drop ELECTRON_RUN_AS_NODE. The filter satisfies electron.launch's
    // env type, which does not accept undefined values.
    const env = Object.fromEntries(
        Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)
    )
    delete env.ELECTRON_RUN_AS_NODE
    // Tell the app it is under e2e so it reveals windows without taking OS focus.
    // Otherwise every launched window steals focus, which is disruptive across a
    // run of dozens of specs. See src/main/focusPolicy.ts.
    env.ROKDOCK_E2E = '1'

    // Isolate persisted state: a throwaway userData dir keeps E2E runs from touching
    // the real electron-store and from sharing the Chromium cache with a running
    // install (which causes "Access is denied" cache collisions). It also gives each
    // run its own single-instance-lock namespace, so tests run even if RokDock is open.
    // A caller may supply a shared dir to persist state across launches (e.g. for
    // session-persistence tests that restart the app within a single test case).
    const dataDir = userDataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'rokdock-e2e-'))

    const app = await electron.launch({
        executablePath: electronExe,
        args: ['out/main/main.js', `--user-data-dir=${dataDir}`, '--no-sandbox', '--disable-gpu', ...extraArgs],
        env,
        // cwd must be the project root so relative paths in main.js resolve correctly.
        // tests/e2e/ is two levels below the root.
        cwd: path.join(__dirname, '..', '..')
    })

    const mainErrors: string[] = []
    app.process().stderr?.on('data', (chunk: Buffer | string) => {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8')
        if (
            text.includes('ReferenceError') ||
            text.includes('is not defined') ||
            text.includes('Uncaught Exception') ||
            text.includes('UnhandledPromiseRejection')
        ) {
            mainErrors.push(text.trim())
        }
    })

    // Capture renderer console output that signals a Content-Security-Policy
    // violation (e.g. "Refused to execute inline script ... Content Security
    // Policy"). The production build runs under the tightened CSP, so any
    // window that still relied on inline scripts would surface here.
    const cspViolations: string[] = []
    const attachCspListener = (page: Page): void => {
        page.on('console', msg => {
            const text = msg.text()
            if (/Content Security Policy|Refused to (execute|load|apply)/i.test(text)) {
                cspViolations.push(`[${page.url()}] ${text}`)
            }
        })
    }
    // Tool windows emit 'window' when created (before their HTML parses), so the
    // listener is attached early enough to catch load-time violations.
    app.on('window', attachCspListener)

    const mainWin = await app.firstWindow()
    // The first window is created during launch, before the 'window' listener
    // above is registered, so attach to it explicitly. (app.on('window') does
    // not re-fire for the already-created first window, so this is not a dup.)
    // A violation firing in the brief window before this attach is still caught
    // by the build-output assertion in csp.spec.ts, which is the authoritative
    // static guarantee that the shipped HTML has no inline-script grant.
    attachCspListener(mainWin)
    await mainWin.waitForLoadState('domcontentloaded')
    return { app, mainWin, mainErrors, cspViolations }
}

/**
 * Drives a tool window through the real menu IPC path: finds the window by title
 * in the main process and sends it a tool-window command. The channel name is
 * passed through the serialized args (the shared constant cannot be imported
 * inside the evaluate callback), so it stays a single source of truth.
 *
 * @param app - The launched Electron application.
 * @param title - The target window's title (e.g. 'JSON Editor', 'SVG Converter').
 * @param command - The typed command payload to deliver.
 */
export async function sendToolWindowCommand(
    app: ElectronApplication,
    title: string,
    command: unknown
): Promise<void> {
    await app.evaluate(({ BrowserWindow }, args) => {
        const win = BrowserWindow.getAllWindows().find(w => w.getTitle() === args.title)
        win?.webContents.send(args.channel, args.command)
    }, { title, command, channel: TOOL_WINDOW_COMMAND_CHANNEL })
}

/**
 * Runs an opener in the main window (e.g. `() => window.rokdock.svgExporter.openEditor()`),
 * waits up to 8s for the new tool window to appear, and returns its loaded Page.
 */
export async function openToolWindow(
    app: ElectronApplication,
    mainWin: Page,
    open: () => unknown
): Promise<Page> {
    const before = app.windows().length
    await mainWin.evaluate(open)
    const deadline = Date.now() + 8_000
    while (Date.now() < deadline) {
        const wins = app.windows()
        if (wins.length > before) {
            const win = wins[wins.length - 1]
            await win.waitForLoadState('domcontentloaded')
            return win
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 100))
    }
    throw new Error('Tool window did not appear')
}
