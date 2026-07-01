#!/usr/bin/env node
/**
 * ASCII-source gate. Every hand-authored source, markup, style, config, and asset
 * file must contain only standard ASCII: anything you cannot type on a standard
 * keyboard does not belong in our comments, code, markup, or text. This walks the
 * repository, scans each text file we own for any non-ASCII character (code point
 * > 127), reports every one with a file:line:column and a fix hint, then exits
 * non-zero so the verification gate fails.
 *
 * Fixes: rewrite comments and decoration in plain ASCII; for a non-ASCII runtime
 * value that is genuinely required, use a `\uXXXX` escape (TS/JS) or an ASCII
 * equivalent so the source stays ASCII; prefer an icon component over a literal glyph.
 */
import fs from 'fs'
import path from 'path'

// Hand-authored text file types. Binary assets (png/ico/icns/woff/...) are skipped by omission.
const sourceExtensions = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.html', '.css', '.json', '.yaml', '.yml', '.svg', '.md',
])
// Generated, vendored, gitignored, or tool-output trees we never hand-edit. `superpowers`
// covers docs/superpowers (gitignored brainstorm/plan artifacts, not shipped docs).
// `demo-video` is the gitignored Remotion marketing video project, not shipped app source.
const skipDirectories = new Set([
    'node_modules', '.git', 'out', 'dist', 'release', 'build', 'coverage',
    'test-results', 'playwright-report', 'graphify-out', '.claude', '.superpowers', 'superpowers',
    'demo-video',
])
// Generated files (upstream non-ASCII) or the gitignored backlog, which intentionally
// documents the banned characters as examples.
const skipFiles = new Set(['package-lock.json', 'BACKLOG.md'])

const hintsByCodePoint = new Map([
    [0xfeff, { name: 'byte-order mark', fix: 'remove it; save the file as UTF-8 without a BOM' }],
    [0x2014, { name: 'em-dash', fix: 'use a plain hyphen or rewrite' }],
    [0x2013, { name: 'en-dash', fix: 'use a plain hyphen' }],
    [0x2500, { name: 'box-drawing horizontal', fix: 'use plain ASCII, or remove the separator' }],
    [0x2550, { name: 'box-drawing double horizontal', fix: 'use plain ASCII, or remove the separator' }],
    [0x2502, { name: 'box-drawing vertical', fix: 'use plain ASCII, or remove the separator' }],
    [0x00d7, { name: 'multiplication sign', fix: "use the letter 'x'" }],
    [0x00f7, { name: 'division sign', fix: "use '/'" }],
    [0x2248, { name: 'almost-equal sign', fix: "use '~' or 'approx'" }],
    [0x00b1, { name: 'plus-minus sign', fix: "use '+/-'" }],
    [0x2192, { name: 'rightwards arrow', fix: "use '->'" }],
    [0x00b7, { name: 'middle dot', fix: "use a plain ASCII separator" }],
    [0x2018, { name: 'left single curly quote', fix: "use a straight ' quote" }],
    [0x2019, { name: 'right single curly quote', fix: "use a straight ' quote" }],
    [0x201c, { name: 'left double curly quote', fix: 'use a straight " quote' }],
    [0x201d, { name: 'right double curly quote', fix: 'use a straight " quote' }],
    [0x2026, { name: 'ellipsis character', fix: 'use three dots ...' }],
])
const genericHint = { name: 'non-ASCII character', fix: 'use an ASCII equivalent, an icon, or a \\uXXXX escape if a non-ASCII runtime value is required' }

/** Recursively collect every hand-authored text file under a directory. */
function collectFiles(directory, found) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!skipDirectories.has(entry.name)) collectFiles(path.join(directory, entry.name), found)
        } else if (sourceExtensions.has(path.extname(entry.name)) && !skipFiles.has(entry.name)) {
            found.push(path.join(directory, entry.name))
        }
    }
    return found
}

const violations = []
for (const file of collectFiles('.', [])) {
    const lines = fs.readFileSync(file, 'utf-8').split('\n')
    lines.forEach((line, lineIndex) => {
        // Iterate by code point so a surrogate-pair emoji counts once.
        let column = 0
        for (const character of line) {
            const codePoint = character.codePointAt(0)
            if (codePoint > 127) {
                const hint = hintsByCodePoint.get(codePoint) ?? genericHint
                const hex = codePoint.toString(16).toUpperCase().padStart(4, '0')
                const relativePath = file.split(path.sep).join('/').replace(/^\.\//, '')
                violations.push({ file: relativePath, line: lineIndex + 1, column: column + 1, hex, hint })
            }
            column += character.length
        }
    })
}

if (violations.length === 0) {
    console.log('check-prose: source is ASCII-only.')
    process.exit(0)
}

console.error(`check-prose: found ${violations.length} non-ASCII character(s):\n`)
for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}:${violation.column}  U+${violation.hex} ${violation.hint.name} (${violation.hint.fix})`)
}
process.exit(1)
