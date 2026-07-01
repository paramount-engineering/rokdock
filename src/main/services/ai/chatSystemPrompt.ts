/**
 * Loads the baked-in chat system prompt from a packaged markdown asset. The prompt
 * is maintainer-editable (edit the .md, no recompile) and never exposed to the renderer.
 * The path mirrors the established main-process resource pattern (see onionOverlays.ts):
 * __dirname/../../resources at runtime resolves to the packaged resources/ directory.
 */
import fs from 'fs'
import path from 'path'

export const DEFAULT_CHAT_PROMPT_PATH = path.join(__dirname, '../../resources/ai/chat-system-prompt.md')

/** Minimal built-in prompt used only if the packaged file cannot be read (packaging mishap). */
export const FALLBACK_CHAT_SYSTEM_PROMPT =
    'You are a helpful development assistant inside RokDock with strong Roku, BrightScript, and SceneGraph expertise. ' +
    "Never fabricate answers: if you do not know, say so. You can see only the text the user shares (terminal output and pasted text) " +
    "and any provided documentation excerpts. You have no access to the user's source code or project files. Be concise."

/** Read the packaged prompt, falling back to the built-in default on any error. */
export function loadChatSystemPrompt(filePath: string = DEFAULT_CHAT_PROMPT_PATH): string {
    try {
        return fs.readFileSync(filePath, 'utf8')
    } catch {
        return FALLBACK_CHAT_SYSTEM_PROMPT
    }
}
