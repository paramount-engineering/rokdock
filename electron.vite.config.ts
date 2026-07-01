import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import type { Plugin } from 'vite'

/** Injected into index.html so the boot splash is never empty on first paint (before the module bundle runs). */
function readPackageVersion(): string {
    try {
        const pkgPath = path.join(__dirname, 'package.json')
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string }
        return typeof pkg.version === 'string' ? pkg.version : ''
    } catch {
        return ''
    }
}

function bootSplashFirstPaintPlugin(version: string): Plugin {
    const verLabel = version ? `v${version}` : ''
    return {
        name: 'boot-splash-first-paint',
        transformIndexHtml(html) {
            return html.replace(/__BOOT_SPLASH_VER__/g, verLabel)
        },
    }
}

/**
 * Injects the critical FOUC guard into every bundled tool-window entry (any HTML
 * whose root element carries data-rokdock-bundled). The two rules hide the body
 * and disable transitions while the rokdock-theme-pending class is set, so the
 * first paint is fully themed with no flash (no unstyled chrome, no animated
 * color change, no font swap). It is injected via head-prepend so it is static,
 * inline, and present at parse time: the bundled stylesheet loads a beat later in
 * dev, so a rule placed there could not prevent the flash. bootBundledTheme()
 * removes the rokdock-theme-pending class once CSS vars are applied and fonts are
 * ready. The dock entry (index.html) has no marker and is left untouched.
 */
function bundledEntryFoucPlugin(): Plugin {
    return {
        name: 'bundled-entry-fouc-guard',
        transformIndexHtml(html) {
            if (!html.includes('data-rokdock-bundled')) return html
            return {
                html,
                tags: [{
                    tag: 'style',
                    attrs: { 'data-rokdock-fouc': '' },
                    children: '.rokdock-theme-pending body{visibility:hidden}.rokdock-theme-pending *{transition:none !important}',
                    injectTo: 'head-prepend',
                }],
            }
        },
    }
}

/**
 * In production builds, removes the 'unsafe-inline' script grant from each
 * entry's CSP meta tag, so the shipped policy is `script-src 'self'`. The grant
 * is only needed in dev (the Vite dev server injects inline HMR scripts). The
 * production bundle has no inline scripts. style-src is intentionally left with
 * 'unsafe-inline' (the FOUC and boot-splash inline styles need it, and inline
 * style injection is low risk). A no-op during `serve` so dev HMR keeps working.
 *
 * The replace target `script-src 'self' 'unsafe-inline'` is distinct from
 * `style-src 'self' 'unsafe-inline'`, so style-src is untouched.
 *
 * After the replace, the build fails if any `script-src` still grants
 * 'unsafe-inline'. The fixed-string replace would silently miss if a source
 * CSP changed token order or inserted a nonce/hash (e.g. `script-src 'self'
 * 'nonce-x' 'unsafe-inline'`), shipping the inline grant. The guard makes the
 * production guarantee hold at build time, independent of the e2e CSP spec
 * (which `npm run dist` does not run). The check is token-order-insensitive and
 * scoped to the script-src directive (it stops at the next `;`), so style-src's
 * retained 'unsafe-inline' does not trip it.
 */
function tightenCspPlugin(): Plugin {
    let isBuild = false
    return {
        name: 'tighten-csp',
        configResolved(config) {
            isBuild = config.command === 'build'
        },
        transformIndexHtml(html, ctx) {
            if (!isBuild) return html
            const tightened = html.replace("script-src 'self' 'unsafe-inline'", "script-src 'self'")
            if (/script-src[^;]*'unsafe-inline'/.test(tightened)) {
                throw new Error(
                    `tighten-csp: ${ctx.path} still grants script-src 'unsafe-inline' after the transform. ` +
                    `The CSP meta tag format likely changed; update tightenCspPlugin's replace.`
                )
            }
            return tightened
        }
    }
}

const packageVersion = readPackageVersion()

export default defineConfig({
    main: {
        plugins: [
            externalizeDepsPlugin(),
            {
                name: 'copy-shared-assets',
                async closeBundle() {
                    const outDir = path.resolve(__dirname, 'out/shared')
                    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
                    copyFileSync(
                        path.resolve(__dirname, 'src/shared/rokdockComponents.css'),
                        path.join(outDir, 'rokdockComponents.css')
                    )

                    // Build controls JS
                    const { build } = await import('vite')
                    await build({
                        configFile: false,
                        build: {
                            lib: {
                                entry: path.resolve(__dirname, 'src/shared/rokdockControls/index.ts'),
                                formats: ['iife'],
                                name: 'RokDockControls',
                                fileName: () => 'rokdockControls.js',
                            },
                            outDir: path.resolve(__dirname, 'out/shared'),
                            emptyOutDir: false,
                            minify: true,
                        },
                    })

                    // Build the MCP stdio bridge as a self-contained CJS bundle.
                    // The spawned `node out/mcpBridge/docsToolBridge.js` must resolve
                    // the SDK with no external node_modules, so the SDK and zod are
                    // bundled in (not externalized).
                    await build({
                        configFile: false,
                        build: {
                            lib: {
                                entry: path.resolve(__dirname, 'src/mcpBridge/docsToolBridge.ts'),
                                formats: ['cjs'],
                                fileName: () => 'docsToolBridge.js',
                            },
                            outDir: path.resolve(__dirname, 'out/mcpBridge'),
                            emptyOutDir: true,
                            minify: false,
                            rollupOptions: {
                                // Only externalize Node.js built-ins. The SDK and zod are
                                // bundled so the output has no runtime node_modules dependency.
                                external: (id: string) => id.startsWith('node:') || (
                                    !id.startsWith('.') && !id.startsWith('/') &&
                                    !id.includes('@modelcontextprotocol') && !id.includes('zod') &&
                                    !id.includes('eventsource') && !id.includes('content-type') &&
                                    // Externalize built-in node modules by name (no node: prefix)
                                    [
                                        'fs', 'path', 'os', 'crypto', 'http', 'https', 'url',
                                        'stream', 'buffer', 'util', 'events', 'net', 'tls',
                                        'child_process', 'readline', 'process',
                                    ].includes(id)
                                ),
                            },
                        },
                        resolve: {
                            conditions: ['node', 'require', 'default'],
                        },
                    })
                }
            } as Plugin
        ],
        build: {
            outDir: 'out/main',
            lib: {
                entry: 'src/main/main.ts'
            }
        }
    },
    preload: {
        plugins: [externalizeDepsPlugin()],
        build: {
            outDir: 'out/preload',
            lib: {
                entry: 'src/preload/preload.ts'
            }
        }
    },
    renderer: {
        plugins: [react(), bootSplashFirstPaintPlugin(packageVersion), bundledEntryFoucPlugin(), tightenCspPlugin()],
        root: 'src/renderer',
        publicDir: false,
        build: {
            // Use absolute output path so packaged builds always include renderer assets.
            outDir: path.resolve(__dirname, 'out/renderer'),
            rollupOptions: {
                input: {
                    index: path.resolve(__dirname, 'src/renderer/index.html'),
                    svgConverter: path.resolve(__dirname, 'src/renderer/svgConverter.html'),
                    ninepatchEditor: path.resolve(__dirname, 'src/renderer/ninepatchEditor.html'),
                    jsonEditor: path.resolve(__dirname, 'src/renderer/jsonEditor.html'),
                    scriptEditor: path.resolve(__dirname, 'src/renderer/scriptEditor.html'),
                    capturePreview: path.resolve(__dirname, 'src/renderer/capturePreview.html'),
                    screenshotPreview: path.resolve(__dirname, 'src/renderer/screenshotPreview.html'),
                    docs: path.resolve(__dirname, 'src/renderer/docs.html')
                }
            }
        },
        resolve: {
            alias: {
                '@renderer': path.resolve(__dirname, 'src/renderer'),
                '@shared': path.resolve(__dirname, 'src/shared')
            }
        }
    }
})
