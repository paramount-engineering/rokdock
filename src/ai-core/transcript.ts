import type { ChatMessage } from './types'

/**
 * Fold a conversation to one labelled transcript. A lone user turn is bare (no label);
 * multiple turns are joined as "User:"/"Assistant:" lines. Used by the engine's dry-run
 * preview and by transports with no native messages API (the CLI adapter).
 */
export function foldMessages(messages: ChatMessage[]): string {
    if (messages.length === 1) return messages[0].content
    return messages.map(message => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`).join('\n\n')
}
