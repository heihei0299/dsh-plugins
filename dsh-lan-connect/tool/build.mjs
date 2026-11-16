import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const require = createRequire(import.meta.url);
const qrManifest = JSON.parse(await readFile(require.resolve('qrcode-generator/package.json'), 'utf8'));

// qrcode-generator is bundled, so its MIT notice must travel with the artifact.
// The source header is stripped by esbuild's default comment handling; this
// legal comment keeps the attribution in dist/client.js.
const THIRD_PARTY_NOTICE = `/*!
 * Bundled third-party software: ${qrManifest.name} ${qrManifest.version}
 * Copyright (c) 2009 Kazuhiko Arase
 * MIT License (https://opensource.org/license/mit)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
`;

// The Host half is plain ESM loaded directly from index.js; only the browser
// half needs bundling. No Host artifact is produced or committed.
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
const client = await build({
  absWorkingDir: root,
  entryPoints: ['src/client.js'],
  bundle: true,
  platform: 'browser',
  target: ['es2022'],
  format: 'cjs',
  // React, including hooks, must come from the host module table. Everything
  // else (the QR encoder and the two locale dictionaries) is bundled locally.
  external: ['react'],
  write: false,
});

const body = client.outputFiles[0]?.text;
if (body === undefined || body === '') throw new Error('Client build produced no artifact');

// A lazy factory, not a second application. React resolves from the host
// require table; the wrapper matches the native __ModuleLoader__ protocol.
const artifact = `${THIRD_PARTY_NOTICE}window.__ModuleLoader__.load({id:${JSON.stringify(manifest.name)},factory(require){\nconst module={exports:{}};const exports=module.exports;\n${body}\nreturn module.exports;\n}});\n`;

await writeFile(new URL('../dist/client.js', import.meta.url), artifact, 'utf8');
console.log('Built dist/client.js. Refresh the existing DSH page after installation.');
