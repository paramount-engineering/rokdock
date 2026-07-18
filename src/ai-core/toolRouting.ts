/**
 * Pure helper for building the tool routing structures from a set of context providers.
 * No Electron, Node, or RokDock imports. Calls tools() once per provider so each
 * provider's tool list is queried exactly one time per invocation.
 */
import type { ContextProvider, ToolDef, ToolResult, ToolCallContext } from './types'

export interface ToolRouting {
    specs: ToolDef[]
    ownerByToolName: Map<string, ContextProvider>
}

/**
 * Dispatch one tool call to its owning provider. Shared by the HTTP toolkit (engine) and the
 * CLI/MCP endpoint (aiService) so the owner lookup, unknown-tool guard, and context threading
 * live in one place.
 */
export function dispatchTool(
    ownerByToolName: Map<string, ContextProvider>,
    name: string,
    args: unknown,
    signal: AbortSignal,
    context?: ToolCallContext,
): Promise<ToolResult> {
    const owner = ownerByToolName.get(name)
    if (!owner?.callTool) return Promise.resolve({ content: `Unknown tool: ${name}`, isError: true })
    return owner.callTool(name, args, signal, context)
}

/**
 * Build the flat spec list and owner map from a set of context providers.
 * Calls provider.tools() at most once per provider so the result is consistent
 * and each provider is not queried twice.
 */
export function buildToolRouting(providers: ContextProvider[]): ToolRouting {
    const providerTools = providers.map(provider => ({ provider, tools: provider.tools?.() ?? [] }))
    const specs: ToolDef[] = providerTools.flatMap(({ tools }) => tools)
    const ownerByToolName = new Map(
        providerTools.flatMap(({ provider, tools }) => tools.map(tool => [tool.name, provider]))
    )
    return { specs, ownerByToolName }
}
