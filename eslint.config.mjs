import checkFile from 'eslint-plugin-check-file'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

// Enforces RokDock's naming convention: camelCase for files and folders.
// PascalCase is reserved for exported symbols (classes, React components),
// never for filenames. See .claude/decisions.md.
export default [
    {
        // tests/e2e is Playwright (commonjs, require, its own tsconfig.e2e.json); it
        // is not covered by this shared flat config and never has been. The unit and
        // integration tests under tests/ (everything except e2e) are linted normally.
        ignores: ['out/**', 'dist/**', 'release/**', 'node_modules/**', 'build/**', 'resources/**', 'scripts/**', 'coverage/**', 'test-results/**', 'playwright-report/**', 'tests/e2e/**']
    },
    {
        files: ['src/**/*.{ts,tsx,js,jsx}', 'tests/**/*.{ts,tsx,js,jsx}'],
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
                ecmaFeatures: { jsx: true }
            }
        },
        plugins: {
            'check-file': checkFile,
            'react-hooks': reactHooks,
            '@typescript-eslint': tseslint.plugin
        },
        rules: {
            'check-file/filename-naming-convention': [
                'error',
                { '**/*.{ts,tsx,js,jsx}': 'CAMEL_CASE' },
                { ignoreMiddleExtensions: true }
            ],
            'check-file/folder-naming-convention': [
                'error',
                { 'src/**/': 'CAMEL_CASE', 'tests/**/': 'CAMEL_CASE' }
            ],
            // rules-of-hooks is a hard React correctness rule: error, no exceptions.
            // exhaustive-deps follows React convention as a warning; intentional
            // omissions are documented with a per-line disable directive.
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'warn',
            // Self-documenting names (see .claude/CLAUDE.md "Code style"). Single-letter
            // names are banned except numeric loop indices (i/j/k), graphics
            // coordinates/dimensions (x/y/w/h), an intentionally-unused binding (_), and the
            // caught-error / event-handler idiom (e), which is used consistently as `e`.
            // Properties are not length-checked (object keys often mirror external schemas).
            'id-length': ['error', { min: 2, exceptions: ['i', 'j', 'k', 'x', 'y', 'w', 'h', '_', 'e'], properties: 'never' }],
            // No snake_case / kebab-case in identifiers we define. Properties are left
            // unconstrained because object keys frequently mirror external API schemas
            // (e.g. tool_calls, web_search), IPC payloads, and CSS-in-JS keys.
            '@typescript-eslint/naming-convention': [
                'error',
                { selector: 'variable', format: ['camelCase', 'UPPER_CASE', 'PascalCase'], leadingUnderscore: 'allow' },
                { selector: 'function', format: ['camelCase', 'PascalCase'] },
                { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
                { selector: 'typeLike', format: ['PascalCase'] },
                { selector: 'import', format: null },
                { selector: ['property', 'objectLiteralProperty', 'typeProperty', 'classProperty', 'enumMember'], format: null }
            ]
        }
    },
    {
        // ai-core is a portable, independent module using kebab-case naming (standard for scoped packages).
        files: ['src/ai-core/**/*.{ts,tsx,js,jsx}', 'tests/ai-core/**/*.{ts,tsx,js,jsx}'],
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
                ecmaFeatures: { jsx: true }
            }
        },
        plugins: {
            'check-file': checkFile,
            'react-hooks': reactHooks
        },
        rules: {
            'check-file/folder-naming-convention': 'off'
        }
    }
]
