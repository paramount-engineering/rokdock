/**
 * Materialize a recognized CLI's declared policy file (today only Gemini's deny-all TOML).
 * ai-core declares the content as data. This is the one filesystem touchpoint that writes it
 * under userData and returns the path the command builder needs. Best-effort: a write failure
 * surfaces later as the CLI's own error at run time.
 */
import fs from 'fs'
import path from 'path'
import { CLI_DEFINITIONS } from '../../../ai-core'
import type { CliKind } from '../../../ai-core/types'

const POLICY_SUBDIR = 'ai-cli-policies'

/** Write the CLI's policy file under `dir/ai-cli-policies` and return its path, or undefined if none. */
export function materializeCliPolicy(kind: CliKind, dir: string): string | undefined {
    const def = CLI_DEFINITIONS[kind]
    if (!def?.policyFile) return undefined
    const policy = def.policyFile
    const outDir = path.join(dir, POLICY_SUBDIR)
    const file = path.join(outDir, policy.filename)
    try {
        fs.mkdirSync(outDir, { recursive: true })
        let current: string | undefined
        try { current = fs.readFileSync(file, 'utf-8') } catch { /* missing */ }
        if (current !== policy.content) fs.writeFileSync(file, policy.content, 'utf-8')
    } catch { /* best-effort */ }
    // Returns the intended path even when the write above was swallowed: the file may not exist.
    // This is the best-effort contract; a missing policy file surfaces later as the CLI's own error.
    return file
}
