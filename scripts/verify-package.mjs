#!/usr/bin/env node
/**
 * Verify the packed tarball before it is installed or published. `files` in
 * package.json is easy to broaden by accident, and an installed bundle cannot
 * recover a missing locale, font, or patch file.
 */
import { execFileSync } from 'node:child_process'
import { stat } from 'node:fs/promises'

const tarball = process.argv[2]
if (tarball === undefined) {
  console.error('usage: node scripts/verify-package.mjs <tarball>')
  process.exit(2)
}

const failures = []
function check(condition, message) {
  if (!condition) failures.push(message)
}

const entries = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)

const allowed = [
  /^package\/$/u,
  /^package\/package\.json$/u,
  /^package\/README\.md$/u,
  /^package\/LICENSE$/u,
  /^package\/icon\.svg$/u,
  /^package\/cordis\.patch\.yml$/u,
  /^package\/locale\/[^/]+\.json$/u,
  /^package\/lib\/.+$/u,
]

for (const entry of entries) {
  if (!allowed.some((pattern) => pattern.test(entry))) {
    check(false, `unexpected file in the tarball: ${entry}`)
  }
}

const required = [
  'package/package.json',
  'package/README.md',
  'package/LICENSE',
  'package/icon.svg',
  'package/cordis.patch.yml',
  'package/lib/host.js',
  'package/lib/client.js',
  'package/lib/assets/canvas.js',
  'package/lib/assets/index.css',
  'package/lib/assets/manifest.json',
  'package/lib/assets/LICENSE-excalidraw',
  'package/lib/assets/THIRD_PARTY_NOTICES.md',
  'package/locale/zh.json',
  'package/locale/en.json',
]
for (const entry of required) check(entries.includes(entry), `missing from the tarball: ${entry}`)

const woff2 = entries.filter((entry) => entry.endsWith('.woff2'))
check(woff2.length >= 234, `only ${woff2.length} WOFF2 fonts are packaged`)
check(entries.some((entry) => /\/locales\/zh-CN-.*\.js$/u.test(entry)), 'the zh-CN locale bundle is missing')
check(entries.some((entry) => /\/locales\/en-.*\.js$/u.test(entry)), 'the en locale bundle is missing')
check(!entries.some((entry) => entry.endsWith('.map')), 'the tarball contains source maps')

let pkg
try {
  pkg = JSON.parse(execFileSync('tar', ['-xOzf', tarball, 'package/package.json'], { encoding: 'utf8' }))
} catch (error) {
  check(false, `cannot read package.json from the tarball: ${error.message}`)
}
if (pkg !== undefined) {
  check(pkg.name === '@zcong/dsh-excalidraw-plugin', 'unexpected package name')
  check(pkg.type === 'module', 'package type must be "module"')
  check(pkg.exports?.['.'] === './lib/host.js', 'the root export does not point at lib/host.js')
  check(pkg.exports?.['./client'] === './lib/client.js', 'the client export is missing')
  check(pkg.dsh?.bundle?.patch === './cordis.patch.yml', 'the bundle patch declaration is missing')
  check(typeof pkg.engines?.dsh === 'string', 'engines.dsh is not pinned')
  check(Array.isArray(pkg.files) && pkg.files.includes('lib'), 'package files does not include lib')
}

const size = await stat(tarball).then((info) => info.size).catch(() => 0)
check(size > 0, 'the tarball is empty')
check(size < 40 * 1024 * 1024, `the tarball is unexpectedly large (${(size / 1024 / 1024).toFixed(1)} MiB)`)

if (failures.length > 0) {
  console.error(`package verification failed (${failures.length}):`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}
console.log(`package verification passed: ${entries.length} entries, ${woff2.length} fonts, ${(size / 1024 / 1024).toFixed(1)} MiB`)
