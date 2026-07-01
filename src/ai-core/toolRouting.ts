/**
 * Pure helper for building the tool routing structures from a set of context providers.
 * No Electron, Node, or RokDock imports. Calls tools() once per provider so each
 * provider's tool list is queried exactly one time per invocation.
 */
import type { ContextProvider, ToolDef } from './types'

export interface ToolRouting {
    specs: ToolDef[]
    ownerByToolName: Map<string, ContextProvider>
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
