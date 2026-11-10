import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const entry = await readFile(new URL('lib/index.js', root), 'utf8');
const shim = await readFile(new URL('index.js', root), 'utf8');

const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/;
const textLength = (value) => [...String(value)].length;

function localeLength(value) {
  if (typeof value === 'string') return textLength(value);
  assert.equal(typeof value, 'object');
  return Math.max(...Object.values(value).map(textLength));
}

test('package exposes the dsh-go host entry and keeps the root shim', () => {
  assert.equal(pkg.main, './lib/index.js');
  assert.equal(pkg.exports['.'], './lib/index.js');
  assert.ok(pkg.files.includes('lib/'));
  assert.match(entry, /export const name = 'mcp-skill-manager'/);
  assert.match(entry, /export const inject = \['tools'\]/);
  assert.match(entry, /ctx\.inject\(\['dshGo'\]/);
  assert.match(shim, /export \* from '\.\/lib\/index\.js'/);
  assert.match(shim, /export \{ default \} from '\.\/lib\/index\.js'/);
});

test('dshGo manifest uses protocol v1 and bounded native surfaces', () => {
  const manifest = pkg.dshGo;
  assert.equal(manifest.v, 1);
  assert.equal(manifest.icon, 'plugin');
  assert.ok(localeLength(manifest.title) <= 24);
  const contributes = manifest.contributes;
  assert.ok(contributes['composer.actions'].length <= 2);
  assert.ok(contributes['composer.tools'].length <= 2);
  assert.ok(contributes.panels.length <= 4);
  assert.equal(contributes.panels[0].id, 'policy');
  assert.deepEqual(contributes.panels[0].placement, ['session.tab', 'features']);
  assert.ok(localeLength(contributes.panels[0].title) <= 16);
  assert.equal(contributes['composer.actions'][0].effect.type, 'open');
  assert.equal(contributes['composer.actions'][0].effect.page, 'panel:policy');
  assert.equal(contributes['composer.tools'][0].panel, 'policy');
});

test('all contribution ids are unique and within the bridge grammar', () => {
  const ids = [];
  for (const rows of Object.values(pkg.dshGo.contributes)) {
    for (const row of rows) ids.push(row.id);
  }
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, ID);
});

test('the manifest stays below the 16 KiB bridge budget', () => {
  assert.ok(Buffer.byteLength(JSON.stringify(pkg.dshGo), 'utf8') < 16 * 1024);
});
