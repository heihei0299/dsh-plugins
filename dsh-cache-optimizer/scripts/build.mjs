import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
await mkdir(new URL('../dist/', import.meta.url), { recursive: true })
await build({
  absWorkingDir: root,
  entryPoints: ['index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  outfile: 'dist/index.js',
  sourcemap: true,
  logLevel: 'info',
})
console.log('Built the dsh-cache-optimizer Host entry (dist/index.js).')
