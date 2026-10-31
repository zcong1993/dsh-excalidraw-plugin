#!/usr/bin/env bun
/**
 * Release helper: bump the version, commit it straight to main, then tag.
 *
 * Release commits bypass the PR gate on purpose (see docs/DEVELOPMENT.md
 * §8.1). `.github/workflows/release.yml` re-runs type-check, lint, tests,
 * build, tarball checks and an install smoke before anything is published,
 * so this script only performs the mechanical steps and never publishes.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const PACKAGE_FILE = 'package.json'
const README_FILE = 'README.md'
const PACKAGE_NAME = '@zcong/dsh-excalidraw-plugin'
const WORKFLOW_URL = 'https://github.com/zcong1993/dsh-excalidraw-plugin/actions/workflows/release.yml'

function fail(message: string): never {
  console.error(`release: ${message}`)
  process.exit(1)
}

function git(args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim()
    fail(`git ${args.join(' ')} failed${stderr === undefined || stderr === '' ? '' : `: ${stderr}`}`)
  }
}

function shell(command: string, args: string[]): void {
  try {
    execFileSync(command, args, { cwd: ROOT, stdio: 'inherit' })
  } catch {
    fail(`${command} ${args.join(' ')} failed`)
  }
}

function parseVersion(version: string, label: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (match === null) fail(`${label} "${version}" is not a plain x.y.z version`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function isGreater(next: [number, number, number], current: [number, number, number]): boolean {
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== current[index]) return next[index] > current[index]
  }
  return false
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const args = process.argv.slice(2)
const flags = new Set(args.filter((arg) => arg.startsWith('-')))
const target = args.find((arg) => !arg.startsWith('-')) ?? ''
const dryRun = flags.has('--dry-run')
const skipChecks = flags.has('--skip-checks')

if (flags.has('--help') || flags.has('-h')) {
  console.log('usage: bun run release <x.y.z> [--dry-run] [--skip-checks]')
  console.log('')
  console.log('  bumps package.json and README, commits on main, pushes main, then tags vX.Y.Z')
  console.log('  --dry-run      show the planned changes without touching the repository')
  console.log('  --skip-checks  skip the local lint and test run before committing')
  process.exit(0)
}

if (target === '') {
  console.error('release: usage: bun run release <x.y.z> [--dry-run] [--skip-checks]')
  process.exit(1)
}

const pkgRaw = readFileSync(join(ROOT, PACKAGE_FILE), 'utf8')
const current = String(JSON.parse(pkgRaw).version)
const nextVersion = parseVersion(target, 'target version')
const currentVersion = parseVersion(current, 'package.json version')
if (!isGreater(nextVersion, currentVersion)) {
  fail(`version ${target} must be greater than the current ${current}`)
}

if (git(['status', '--porcelain']) !== '') fail('the working tree is dirty; commit or stash first')
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
if (!dryRun && branch !== 'main') fail(`run this from the main branch, currently on "${branch}"`)
git(['fetch', 'origin', '--tags', '--prune'])
if (!dryRun && git(['rev-parse', 'HEAD']) !== git(['rev-parse', 'origin/main'])) {
  fail('main is not at origin/main; pull or rebase first')
}
if (git(['tag', '--list', `v${target}`]) !== '') fail(`tag v${target} already exists`)

const nextPkg = pkgRaw.replace(/("version"\s*:\s*")[^"]+(")/, `$1${target}$2`)
const readmeRaw = readFileSync(join(ROOT, README_FILE), 'utf8')
const nextReadme = readmeRaw
  .replace(new RegExp(`(${escapeRegExp(PACKAGE_NAME)}@)${escapeRegExp(current)}`, 'g'), `$1${target}`)
  .replace(new RegExp(`("${escapeRegExp(PACKAGE_NAME)}":\\s*"\\^)${escapeRegExp(current)}`, 'g'), `$1${target}`)

if (nextPkg === pkgRaw) fail(`could not find the version field in ${PACKAGE_FILE}`)
if (nextReadme === readmeRaw) fail(`could not find ${current} install references in ${README_FILE}`)
if (nextReadme.includes(`${PACKAGE_NAME}@${current}`) || nextReadme.includes(`"${PACKAGE_NAME}": "^${current}"`)) {
  fail(`${README_FILE} still references ${current}; update the remaining install instructions by hand`)
}

if (dryRun) {
  console.log(`release: ${current} -> ${target} (dry run)`)
  console.log(`  ${PACKAGE_FILE}: version ${current} -> ${target}`)
  console.log(`  ${README_FILE}: install references ${current} -> ${target}`)
  console.log('  would commit "chore(release): v' + target + '", push main, then tag v' + target)
  process.exit(0)
}

if (!skipChecks) {
  console.log('release: running local lint and tests')
  shell('pnpm', ['run', 'lint'])
  shell('bun', ['test'])
}

writeFileSync(join(ROOT, PACKAGE_FILE), nextPkg)
writeFileSync(join(ROOT, README_FILE), nextReadme)
git(['add', PACKAGE_FILE, README_FILE])
git(['commit', '-m', `chore(release): v${target}`])
console.log(`release: committed v${target} on main`)
git(['push', 'origin', 'HEAD:main'])
console.log('release: pushed main')
git(['tag', '-a', `v${target}`, '-m', `v${target}`])
git(['push', 'origin', `v${target}`])
console.log(`release: pushed tag v${target}; the release workflow is now running`)
console.log(`release: ${WORKFLOW_URL}`)
