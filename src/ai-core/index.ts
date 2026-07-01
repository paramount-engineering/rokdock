/**
 * Public entry for the portable AI engine core. Anything outside src/ai-core
 * imports from here. Zero Electron, zero RokDock, zero Roku knowledge.
 */
export { createAiEngine } from './engine'
export type { AiEngine } from './engine'
export { redact } from './redaction'
export { cliAdapter } from './adapters/cli'
export { anthropicAdapter } from './adapters/anthropic'
export { geminiAdapter } from './adapters/gemini'
export { openAiCompatibleAdapter } from './adapters/openaiCompatible'
export { CLI_DEFINITIONS, CLI_KINDS, buildCliCommand, isCliKind } from './adapters/cliRegistry'
export type { CliDefinition, CliBuildOptions } from './adapters/cliRegistry'
export * from './types'
