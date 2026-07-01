#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const readline = require('readline/promises')
const { stdin, stdout } = require('process')

const ROOT_DIR = path.resolve(__dirname, '..')
const PACKAGE_JSON_PATH = path.join(ROOT_DIR, 'package.json')
const RELEASE_ARGS = new Set(process.argv.slice(2))

function runCommand(command, args, options = {}) {
    const cmdStr = [command, ...args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')
    console.log(`$ ${cmdStr}`)
    const result = spawnSync(command, args, {
        cwd: ROOT_DIR,
        stdio: options.captureOutput ? 'pipe' : 'inherit',
        encoding: 'utf8'
    })
    if (result.status !== 0) {
        const suffix = options.captureOutput && result.stderr ? `\n${result.stderr}` : ''
        throw new Error(`Command failed: ${command} ${args.join(' ')}${suffix}`)
    }
    return result.stdout?.trim() ?? ''
}

function parseVersion(versionText) {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(versionText)
    if (!match) return null
    return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function bumpVersion(versionText, kind) {
    const parsed = parseVersion(versionText)
    if (!parsed) throw new Error(`Unsupported version format: ${versionText}`)
    const [major, minor, patch] = parsed
    if (kind === 'patch') return `${major}.${minor}.${patch + 1}`
    if (kind === 'minor') return `${major}.${minor + 1}.0`
    if (kind === 'major') return `${major + 1}.0.0`
    throw new Error(`Unsupported bump kind: ${kind}`)
}

/** Tag name: v{major}.{minor}.{patch} e.g. v1.2.3. Kept flat (no `v1.x/` prefix)
 *  because electron-builder keys its GitHub release off this exact `v${version}`
 *  tag, and electron-updater resolves updates from that release. */
function releaseTagFromVersion(versionText) {
    const parsed = parseVersion(versionText)
    if (!parsed) throw new Error(`Unsupported version format: ${versionText}`)
    const [major, minor, patch] = parsed
    return `v${major}.${minor}.${patch}`
}

function ensureCleanGitState() {
    const status = runCommand('git', ['status', '--porcelain'], { captureOutput: true })
    if (status.length > 0) {
        throw new Error(
            'Working tree has uncommitted changes. Commit/stash changes before running release.'
        )
    }
}

function hasGitTag(tag) {
    const result = spawnSync('git', ['rev-parse', '--verify', '--quiet', tag], {
        cwd: ROOT_DIR,
        stdio: 'ignore'
    })
    return result.status === 0
}

function hasGhCli() {
    const command = process.platform === 'win32' ? 'where' : 'which'
    const result = spawnSync(command, ['gh'], {
        cwd: ROOT_DIR,
        stdio: 'ignore'
    })
    return result.status === 0
}

/**
 * Returns the existing GitHub release body for the given tag, or null if no
 * release exists. Requires `gh` CLI.
 */
function getExistingReleaseBody(tag) {
    const result = spawnSync('gh', ['release', 'view', tag, '--json', 'body', '-q', '.body'], {
        cwd: ROOT_DIR,
        stdio: 'pipe',
        encoding: 'utf8'
    })
    if (result.status !== 0) return null
    return result.stdout?.trim() ?? null
}

function deleteGitTag(tag) {
    // Delete local tag
    spawnSync('git', ['tag', '-d', tag], {
        cwd: ROOT_DIR,
        stdio: 'ignore'
    })
    // Delete remote tag (best-effort, may not exist remotely)
    spawnSync('git', ['push', 'origin', '--delete', tag], {
        cwd: ROOT_DIR,
        stdio: 'ignore'
    })
}

function deleteGhRelease(tag) {
    spawnSync('gh', ['release', 'delete', tag, '--yes'], {
        cwd: ROOT_DIR,
        stdio: 'inherit',
        encoding: 'utf8'
    })
}

async function askYesNo(rl, prompt, defaultValue = false) {
    const suffix = defaultValue ? ' [Y/n]: ' : ' [y/N]: '
    const input = (await rl.question(`${prompt}${suffix}`)).trim().toLowerCase()
    if (!input) return defaultValue
    return input === 'y' || input === 'yes'
}

const RELEASE_EXT = /\.(dmg|zip|exe|AppImage|deb|rpm)$/i

function findDistAssets(version) {
    const distDir = path.join(ROOT_DIR, 'dist')
    if (!fs.existsSync(distDir)) return []
    return fs.readdirSync(distDir)
        .map((name) => path.join(distDir, name))
        .filter((p) => {
            if (!fs.statSync(p).isFile()) return false
            const base = path.basename(p)
            if (!base.includes(version)) return false
            if (base.startsWith('.') || base.endsWith('.blockmap')) return false
            if (/\.(yml|yaml)$/i.test(base) || /^builder-/.test(base)) return false
            return RELEASE_EXT.test(p)
        })
}

/**
 * Returns the AppImage install/uninstall scripts from build/linux/ if present.
 * These are shipped as release assets so AppImage users can integrate per-tool
 * launchers without a deb package.
 */
function findAppImageScripts() {
    const linuxDir = path.join(ROOT_DIR, 'build', 'linux')
    const scriptNames = ['install-tool-shortcuts.sh', 'uninstall-tool-shortcuts.sh']
    return scriptNames
        .map((name) => path.join(linuxDir, name))
        .filter((p) => fs.existsSync(p) && fs.statSync(p).isFile())
}

function createGhRelease(releaseTag, version, distFiles, existingReleaseBody) {
    const appImageScripts = findAppImageScripts()
    const allAssets = [...distFiles, ...appImageScripts]
    if (allAssets.length === 0) {
        console.log(`No installer/archive files for ${version} in dist/ to upload; skipping GitHub release assets.`)
        return
    }
    if (appImageScripts.length > 0) {
        console.log(`Including ${appImageScripts.length} AppImage install script(s) as release assets.`)
    }
    // Create as a draft, then publish once every asset is attached: on repos with
    // GitHub's immutable releases enabled, a published release can never receive
    // more assets, even ones passed to the same `gh release create` call, since
    // the release is marked published before the upload requests land.
    const ghCreateArgs = ['release', 'create', releaseTag, '--draft', '--title', version, ...allAssets]
    if (existingReleaseBody) {
        ghCreateArgs.push('--notes', existingReleaseBody)
    } else {
        ghCreateArgs.push('--generate-notes')
    }
    runCommand('gh', ghCreateArgs)
    runCommand('gh', ['release', 'edit', releaseTag, '--draft=false'])
}

async function releaseOnly() {
    const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'))
    const version = packageJson.version
    if (!parseVersion(version)) {
        throw new Error(`Current package version is not semver x.y.z: ${version}`)
    }

    if (!hasGhCli()) {
        throw new Error('gh CLI not found. Install it with: brew install gh')
    }

    const releaseTag = releaseTagFromVersion(version)
    console.log(`Version: ${version}`)
    console.log(`Tag: ${releaseTag}`)

    if (!hasGitTag(releaseTag)) {
        throw new Error(`Tag ${releaseTag} does not exist. Run a full release first.`)
    }

    const existingBody = getExistingReleaseBody(releaseTag)
    if (existingBody !== null) {
        const rl = readline.createInterface({ input: stdin, output: stdout })
        try {
            if (!(await askYesNo(rl, `A GitHub release already exists for ${releaseTag}. Replace it?`, false))) {
                throw new Error('Release aborted by user.')
            }
        } finally {
            rl.close()
        }
        console.log('Deleting existing GitHub release (preserving notes)...')
        deleteGhRelease(releaseTag)
    }

    const distFiles = findDistAssets(version)
    console.log(`Found ${distFiles.length} asset(s) in dist/:`)
    for (const f of distFiles) console.log(`  ${path.basename(f)}`)

    createGhRelease(releaseTag, version, distFiles, existingBody)
    console.log('\nGitHub release created.')
}

async function main() {
    if (RELEASE_ARGS.has('--release-only')) {
        return releaseOnly()
    }

    const forceReplace = RELEASE_ARGS.has('--replace')
    let skipVersionBump = RELEASE_ARGS.has('--skip-version-bump') || RELEASE_ARGS.has('--no-bump') || forceReplace
    const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'))
    const currentVersion = packageJson.version
    if (!parseVersion(currentVersion)) {
        throw new Error(`Current package version is not semver x.y.z: ${currentVersion}`)
    }

    const rl = readline.createInterface({ input: stdin, output: stdout })
    try {
        console.log(`Current version: ${currentVersion}`)
        let nextVersion = currentVersion
        if (skipVersionBump) {
            console.log(forceReplace ? 'Skipping version bump (--replace).' : 'Skipping version bump (--skip-version-bump).')
        } else {
            const bumpChoice = (
                await rl.question('Version bump: patch / minor / major / custom / skip [patch]: ')
            )
                .trim()
                .toLowerCase() || 'patch'

            if (bumpChoice === 'c' || bumpChoice === 'custom') {
                const customVersion = (await rl.question('New version (x.y.z): ')).trim()
                if (!parseVersion(customVersion)) {
                    throw new Error(`Invalid custom version: ${customVersion}`)
                }
                nextVersion = customVersion
            } else if (bumpChoice === 'p' || bumpChoice === 'patch') {
                nextVersion = bumpVersion(currentVersion, 'patch')
            } else if (bumpChoice === 'mi' || bumpChoice === 'minor') {
                nextVersion = bumpVersion(currentVersion, 'minor')
            } else if (bumpChoice === 'ma' || bumpChoice === 'major') {
                nextVersion = bumpVersion(currentVersion, 'major')
            } else if (bumpChoice === 's' || bumpChoice === 'skip' || bumpChoice === 'none') {
                skipVersionBump = true
            } else {
                throw new Error(`Unsupported bump choice: ${bumpChoice}`)
            }

            if (!skipVersionBump && nextVersion === currentVersion) {
                throw new Error('New version matches current version.')
            }
        }

        let releaseTag = releaseTagFromVersion(nextVersion)
        let existingReleaseBody = null

        if (hasGitTag(releaseTag)) {
            console.log(`\nTag already exists: ${releaseTag}`)
            const ghAvailable = hasGhCli()
            if (ghAvailable) {
                existingReleaseBody = getExistingReleaseBody(releaseTag)
                if (existingReleaseBody) {
                    console.log('A GitHub release also exists for this tag.')
                } else {
                    console.log('No GitHub release found for this tag (only a local/remote git tag).')
                }
            }

            const action = forceReplace
                ? 'replace'
                : (await rl.question('Action: bump / replace / abort [abort]: ')).trim().toLowerCase() || 'abort'
            if (forceReplace) console.log('Replacing automatically (--replace).')

            if (action === 'b' || action === 'bump') {
                const bumpKind = (
                    await rl.question('Version bump: patch / minor / major [patch]: ')
                ).trim().toLowerCase() || 'patch'
                const resolvedKind =
                    bumpKind === 'p' || bumpKind === 'patch' ? 'patch' :
                    bumpKind === 'mi' || bumpKind === 'minor' ? 'minor' :
                    bumpKind === 'ma' || bumpKind === 'major' ? 'major' : null
                if (!resolvedKind) {
                    throw new Error(`Unsupported bump kind: ${bumpKind}`)
                }
                nextVersion = bumpVersion(nextVersion, resolvedKind)
                skipVersionBump = false
                releaseTag = releaseTagFromVersion(nextVersion)
                console.log(`Bumped to ${nextVersion} (tag: ${releaseTag})`)
                if (hasGitTag(releaseTag)) {
                    throw new Error(`Tag also already exists: ${releaseTag}`)
                }
                existingReleaseBody = null
            } else if (action === 'r' || action === 'replace') {
                console.log('Replacing existing release...')
                if (ghAvailable && existingReleaseBody !== null) {
                    console.log('Preserving existing release notes.')
                    deleteGhRelease(releaseTag)
                }
                console.log(`Deleting tag ${releaseTag} (will be recreated at HEAD)...`)
                deleteGitTag(releaseTag)
            } else {
                throw new Error('Release aborted by user.')
            }
        }

        ensureCleanGitState()

        if (!hasGhCli()) {
            throw new Error('gh CLI not found (needed to publish the release). Install it with: brew install gh')
        }

        if (!skipVersionBump) {
            packageJson.version = nextVersion
            fs.writeFileSync(PACKAGE_JSON_PATH, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')
            console.log(`Updated package.json version -> ${nextVersion}`)
        } else {
            console.log(`Using existing package.json version -> ${nextVersion}`)
        }

        // Installers are built on GitHub runners, not here. Pushing the tag is the
        // trigger for the build workflow, so this script bumps the version, tags it,
        // pushes, and creates a draft release for the workflow to attach installers
        // to. The workflow publishes the release itself once every platform succeeds:
        // on repos with GitHub's immutable releases feature enabled, a published
        // release can never receive more assets, so nothing may attach to it until
        // publishing happens last.
        console.log(`\nThis will tag, push, and create a draft release for ${releaseTag}.`)
        console.log('Pushing the tag triggers the GitHub Actions build, which attaches the installers and publishes the release once every platform succeeds.')
        if (!(await askYesNo(rl, 'Proceed?', false))) {
            throw new Error('Release aborted by user.')
        }

        if (!skipVersionBump) {
            runCommand('git', ['add', 'package.json'])
            runCommand('git', ['commit', '-m', `chore: release ${releaseTag}`])
        }
        runCommand('git', ['tag', releaseTag])
        runCommand('git', ['push'])
        runCommand('git', ['push', 'origin', releaseTag])

        const ghCreateArgs = ['release', 'create', releaseTag, '--draft', '--title', nextVersion]
        if (existingReleaseBody) {
            ghCreateArgs.push('--notes', existingReleaseBody)
        } else {
            ghCreateArgs.push('--generate-notes')
        }
        runCommand('gh', ghCreateArgs)

        console.log('\nDraft release created.')
        console.log(`Tag: ${releaseTag}`)
        console.log('GitHub Actions is now building the installers and will publish the release once every platform succeeds.')
        console.log('Track it from the Actions tab or with: gh run watch')
    } finally {
        rl.close()
    }
}

main().catch((error) => {
    console.error(`\nRelease failed: ${error.message}`)
    process.exit(1)
})
