import { describe, it, expect } from 'vitest'
import { parsePluginMessages, pluginInstallResult } from '@main/utils/screenshot'

// The Roku /plugin_install response embeds its result as a `JSON.parse('{...}')` blob with a
// `messages` array of { text, type }. A failed install emits BOTH a benign type:'success'
// "Application Received" line (upload received) AND a type:'error' failure line. The bug this
// covers: reading only the first message treated the "received" line as install success.
const FAILURE_HTML = `<script>var params = JSON.parse('{"messages":[{"text":"Application Received: 128265 bytes stored.","text_type":"text","type":"success"},{"text":"Install Failure: No manifest. Invalid package.","text_type":"text","type":"error"}],"packages":[]}');</script>`

const SUCCESS_HTML = `<script>var params = JSON.parse('{"messages":[{"text":"Application Received: 445388 bytes stored.","text_type":"text","type":"success"},{"text":"Install Success.","text_type":"text","type":"success"}],"packages":[]}');</script>`

// Older firmware without the JSON blob: red-font lines only, no type.
const LEGACY_FAILURE_HTML = `<div style="display:none"><font color="red">Install Failure: No manifest. Invalid package.</font></div>`

describe('parsePluginMessages', () => {
    it('extracts every message with its type from the JSON blob', () => {
        expect(parsePluginMessages(FAILURE_HTML)).toEqual([
            { type: 'success', text: 'Application Received: 128265 bytes stored.' },
            { type: 'error', text: 'Install Failure: No manifest. Invalid package.' }
        ])
    })

    it('falls back to red-font lines for legacy firmware, tagged as errors (red font = failure)', () => {
        expect(parsePluginMessages(LEGACY_FAILURE_HTML)).toEqual([
            { type: 'error', text: 'Install Failure: No manifest. Invalid package.' }
        ])
    })

    it('returns an empty list when there are no messages', () => {
        expect(parsePluginMessages('<html><body>nothing here</body></html>')).toEqual([])
    })
})

describe('pluginInstallResult', () => {
    it('reports failure and surfaces the error message, not the benign "received" line', () => {
        expect(pluginInstallResult(FAILURE_HTML)).toEqual({
            ok: false,
            message: 'Install Failure: No manifest. Invalid package.'
        })
    })

    it('reports success and surfaces the final message', () => {
        expect(pluginInstallResult(SUCCESS_HTML)).toEqual({ ok: true, message: 'Install Success.' })
    })

    it('treats a legacy red-font failure line as a failure via its text', () => {
        expect(pluginInstallResult(LEGACY_FAILURE_HTML)).toEqual({
            ok: false,
            message: 'Install Failure: No manifest. Invalid package.'
        })
    })

    it('treats a legacy red-font failure with no failure keyword as a failure (red font = error)', () => {
        const html = `<font color="red">Error opening package</font>`
        expect(pluginInstallResult(html)).toEqual({ ok: false, message: 'Error opening package' })
    })

    it('treats a response with no messages as success (nothing to report)', () => {
        expect(pluginInstallResult('<html></html>')).toEqual({ ok: true, message: 'Application installed.' })
    })
})
