import { build } from 'esbuild'
import { cp, copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import postcss from 'postcss'
import selectorParser from 'postcss-selector-parser'

const PKG = '@local/dsh-excalidraw-preview'
const EXCALIDRAW = 'node_modules/@excalidraw/excalidraw/dist/prod'
const ASSETS = 'lib/assets'

function reactShim() {
  return {
    name: 'excalidraw-react-shim',
    setup(buildApi) {
      buildApi.onResolve({ filter: /^(react|react-dom|react\/jsx-runtime|react-dom\/client)$/ }, (args) => ({
        path: args.path,
        namespace: 'excalidraw-shared-react',
      }))
      buildApi.onLoad({ filter: /.*/, namespace: 'excalidraw-shared-react' }, (args) => {
        const expression = args.path === 'react'
          ? 'shared.React'
          : args.path === 'react-dom'
            ? 'shared.ReactDOM'
            : args.path === 'react-dom/client'
              ? '(shared.ReactDOMClient ?? shared.ReactDOM)'
              : 'shared.jsxRuntime'
        return {
          loader: 'js',
          contents: [
            'const shared = window.__DSH_EXCALIDRAW_SHARED__;',
            'if (shared === undefined) throw new Error("Excalidraw shared React runtime is not installed");',
            `const value = ${expression};`,
            'module.exports = value;',
            'try { module.exports.default = value; } catch {}',
          ].join('\n'),
        }
      })
    },
  }
}

const common = {
  bundle: true,
  platform: 'browser',
  target: ['es2022'],
  format: 'iife',
  minify: false,
  sourcemap: false,
  legalComments: 'none',
  define: {
    'process.env.NODE_ENV': '"production"',
    'process.env': '{}',
  },
  loader: {
    '.woff2': 'file',
    '.woff': 'file',
    '.ttf': 'file',
    '.otf': 'file',
    '.svg': 'dataurl',
    '.png': 'dataurl',
    '.jpg': 'dataurl',
    '.jpeg': 'dataurl',
    '.gif': 'dataurl',
  },
  plugins: [reactShim()],
}

await rm('lib', { recursive: true, force: true })
await mkdir(ASSETS, { recursive: true })

// 1. Official canvas runtime as an independent lazy chunk.
await build({
  ...common,
  entryPoints: ['canvas-entry.js'],
  outfile: `${ASSETS}/canvas.js`,
  globalName: '__DshExcalidrawCanvas',
  banner: {
    js: "window.EXCALIDRAW_ASSET_PATH = new URL('api/excalidraw-assets/', document.baseURI).href;",
  },
})

// 2. Client plugin factory.
const clientBanner = [
  `window.__ModuleLoader__.load({`,
  `  id: '${PKG}',`,
  `  factory(require) {`,
  `    const React = require('react');`,
  `    const ReactDOM = require('react-dom');`,
  `    let ReactDOMClient;`,
  `    try { ReactDOMClient = require('react-dom/client'); } catch {}`,
  `    const jsxRuntime = require('react/jsx-runtime');`,
  `    window.__DSH_EXCALIDRAW_SHARED__ = { React, ReactDOM, ReactDOMClient, jsxRuntime };`,
].join('\n')
const clientFooter = [
  '',
  `    return __DshExcalidrawClientModule;`,
  `  },`,
  `});`,
].join('\n')

await build({
  ...common,
  entryPoints: ['src/client/index.js'],
  outfile: 'lib/client.js',
  globalName: '__DshExcalidrawClientModule',
  banner: { js: clientBanner },
  footer: { js: clientFooter },
})

// 3. Official assets: fonts (including Chinese), locales, scoped CSS.
await cp(`${EXCALIDRAW}/fonts`, `${ASSETS}/fonts`, { recursive: true })
if (existsSync(`${EXCALIDRAW}/locales`)) {
  await cp(`${EXCALIDRAW}/locales`, `${ASSETS}/locales`, { recursive: true })
}

const rawCss = await readFile(`${EXCALIDRAW}/index.css`, 'utf8')
const fontCss = rawCss
const root = postcss.parse(fontCss)
root.walkRules((rule) => {
  const parent = rule.parent
  if (parent && parent.type === 'atrule' && /keyframes$/iu.test(parent.name)) return
  rule.selector = selectorParser((selectors) => {
    selectors.each((selector) => {
      const first = selector.first
      if (first === undefined) return
      if (first.type === 'class' && first.value === 'dsh-excalidraw-plugin') return
      if (first.type === 'tag' && (first.value === 'html' || first.value === 'body')) {
        first.value = 'div'
      }
      selector.prepend(selectorParser.combinator({ value: ' ' }))
      selector.prepend(selectorParser.className({ value: 'dsh-excalidraw-plugin' }))
    })
  }).processSync(rule.selector)
})
await writeFile(`${ASSETS}/index.css`, root.toString(), 'utf8')

// 4. Retain the upstream license and notices next to the bundled runtime.
await copyFile('src/assets/LICENSE-excalidraw', join(ASSETS, 'LICENSE-excalidraw'))
await copyFile('src/assets/THIRD_PARTY_NOTICES.md', join(ASSETS, 'THIRD_PARTY_NOTICES.md'))

const fonts = await readdir(`${ASSETS}/fonts`, { withFileTypes: true })
const woff2 = fonts.filter((entry) => entry.isDirectory())
  .flatMap(async (entry) => (await readdir(`${ASSETS}/fonts/${entry.name}`)).filter((name) => name.endsWith('.woff2')).length)
const counts = await Promise.all(woff2)
const manifest = {
  source: '@excalidraw/excalidraw@0.18.0',
  fontFiles: counts.reduce((sum, count) => sum + count, 0),
  families: fonts.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
  assetPath: '/api/excalidraw-assets/',
}
await writeFile(`${ASSETS}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

console.log(`built lib/client.js and lib/assets (${manifest.fontFiles} woff2 files, ${manifest.families.join(', ')})`)
