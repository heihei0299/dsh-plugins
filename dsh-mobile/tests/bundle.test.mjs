import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

test('declares the bundle layer the plugin manager reads', () => {
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml');
  assert.ok(existsSync(path.join(root, manifest.dsh.bundle.patch)));
});

test('bundle patch inserts the entry the package exports', () => {
  const patch = readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8');
  assert.match(patch, /- insert:\n {4}- id: dsh-mobile\n {6}name: '@local\/dsh-mobile'\n$/);
});

test('bundle patch ships no user-facing setting, so enabling it cannot change a desktop profile', () => {
  const body = readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8').replace(/^\s*#.*$/gm, '');
  assert.doesNotMatch(body, /mode:|drawerNavigation:|comfortableTargets:/);
});

test('declares one dsh requirement the plugin manager can check', () => {
  const peers = Object.keys(manifest.peerDependencies ?? {}).filter(name => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'));
  assert.ok(typeof manifest.engines?.dsh === 'string' || peers.length > 0);
  assert.equal(manifest.engines?.dsh, '0.2.1-rc.2');
});

test('declares a web client bundle with the services it injects', () => {
  assert.equal(manifest.dsh?.client?.platform, 'web');
  assert.equal(manifest.dsh.client.immediately, true);
  assert.equal(manifest.exports['./client'], './dist/client.js');
  assert.ok(Array.isArray(manifest.dsh.client.inject) && manifest.dsh.client.inject.length > 0);
});

test('exports an icon inside the package', () => {
  const icon = manifest.exports?.['./icon'];
  assert.equal(icon, './assets/icon.svg');
  const file = path.join(root, icon);
  assert.ok(existsSync(file));
  assert.ok(statSync(file).size <= 256 * 1024);
});

test('the committed artifact is what the loader entry points at', () => {
  assert.equal(manifest.exports?.['.'], './dist/host/index.js');
  assert.ok(existsSync(path.join(root, manifest.exports['.'])), 'run `pnpm run build` before verifying the bundle');
  assert.ok(existsSync(path.join(root, manifest.exports['./client'])), 'run `pnpm run build` before verifying the bundle');
});

for (const language of ['en', 'zh']) {
  test(`locale/${language}.json carries the plugin-card metadata`, () => {
    const dict = JSON.parse(readFileSync(path.join(root, 'locale', `${language}.json`), 'utf8'));
    assert.ok(typeof dict.meta?.title === 'string' && dict.meta.title.length > 0);
    assert.ok(typeof dict.meta?.description === 'string' && dict.meta.description.length > 0);
  });
}
