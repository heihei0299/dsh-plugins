import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
await mkdir(new URL('../dist/host/', import.meta.url), { recursive: true });
await build({
  absWorkingDir: root, entryPoints: ['src/host/index.ts'], bundle: true,
  platform: 'node', target: 'node22', format: 'esm', packages: 'external',
  outfile: 'dist/host/index.js', sourcemap: true,
});
const client = await build({
  absWorkingDir: root, entryPoints: ['src/client/index.tsx'], bundle: true,
  platform: 'browser', target: ['es2022'], format: 'cjs', external: ['react'],
  loader: { '.css': 'text' }, write: false,
});
const body = client.outputFiles[0]?.text;
if (!body) throw new Error('Client build produced no artifact');
// A lazy factory, not a second application. React resolves from the host table.
const artifact = `window.__ModuleLoader__.load({id:${JSON.stringify(manifest.name)},factory(require){\nconst module={exports:{}};const exports=module.exports;\n${body}\nreturn module.exports;\n}});\n`;
await writeFile(new URL('../dist/client.js', import.meta.url), artifact, 'utf8');
console.log('Built DSH Host entry and lazy Client factory. Refresh the existing DSH page after installation.');
