import { mkdir } from 'node:fs/promises'
import { build } from 'esbuild'

await mkdir('lib', { recursive: true })
await build({
  entryPoints: ['src/host/index.js'],
  outfile: 'lib/host.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: ['node22'],
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
  loader: { '.md': 'text' },
})
console.log('built lib/host.js')
