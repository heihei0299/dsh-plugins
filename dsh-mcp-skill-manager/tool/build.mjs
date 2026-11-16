import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
const client = await build({
  absWorkingDir: root,
  entryPoints: ['src/client/index.js'],
  bundle: true,
  platform: 'browser',
  target: ['es2022'],
  format: 'cjs',
  // React comes from the host module table; the dictionaries and pure
  // helpers stay in the bundle.
  external: ['react'],
  write: false
});

const body = client.outputFiles[0]?.text;
if (body === undefined || body === '') throw new Error('Client build produced no artifact');

// A lazy factory, not a second application. React resolves from the host
// require table; the wrapper matches the native __ModuleLoader__ protocol.
const artifact = `window.__ModuleLoader__.load({id:${JSON.stringify(manifest.name)},factory(require){\nconst module={exports:{}};const exports=module.exports;\n${body}\nreturn module.exports;\n}});\n`;

await writeFile(new URL('../dist/client.js', import.meta.url), artifact, 'utf8');
console.log('Built dist/client.js. Refresh the existing DSH page after installation.');
