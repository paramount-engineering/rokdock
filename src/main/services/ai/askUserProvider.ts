/**
 * A single tool that lets roBot ask the user a multiple-choice question and get the answer as
 * clickable options, instead of asking in prose and waiting for the user to type a reply. The
 * host presents the choices (a dialog) via the tool-call context's ask() hook.
 */
import type { ContextProvider, ToolDef, ToolResult, ToolCallContext } from '../../../ai-core/types'

const ASK_USER: ToolDef = {
    name: 'ask_user',
    description: 'Ask the user a question and offer clickable answer choices, then receive their pick. Prefer this over asking in prose whenever the user should choose among options (which device, which channel, yes or no, and so on). Offer ALL the relevant options, not only a few: this tool accepts up to 12 choices and renders each as a button. This is RokDock\'s own tool, unrelated to any 2-to-4-option limit you may assume from elsewhere.',
    parameters: {
        type: 'object',
        properties: {
            question: { type: 'string', description: 'The question to show the user.' },
            options: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 12, description: 'The answer choices to render as buttons. Include every relevant option (2 to 12), do not trim the list to a handful.' },
        },
        required: ['question', 'options'],
    },
}

export function createAskUserProvider(): ContextProvider {
    return {
        name: 'user-interaction',
        tools: () => [ASK_USER],
        async callTool(name: string, args: unknown, _signal: AbortSignal, context?: ToolCallContext): Promise<ToolResult> {
            if (name !== 'ask_user') return { content: `Unknown tool: ${name}`, isError: true }
            const record = (args ?? {}) as Record<string, unknown>
            const question = typeof record.question === 'string' ? record.question.trim() : ''
            const options = Array.isArray(record.options) ? record.options.map(option => String(option)).filter(option => option.trim()) : []
            if (!question) return { content: 'ask_user requires a question.', isError: true }
            if (options.length === 0) return { content: 'ask_user requires at least one option.', isError: true }
            if (!context?.ask) return { content: 'Cannot show a choice prompt in this context. Ask the user in plain text instead.', isError: true }
            const answer = await context.ask(question, options)
            if (answer === null) return { content: 'The user dismissed the question without choosing.', isError: true }
            return { content: `The user chose: ${answer}` }
        },
    }
}
