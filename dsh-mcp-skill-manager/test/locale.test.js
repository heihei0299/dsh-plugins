import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const clientDir = new URL('../src/client/', import.meta.url);
const en = JSON.parse(await readFile(new URL('../locale/en.json', import.meta.url), 'utf8'));
const zh = JSON.parse(await readFile(new URL('../locale/zh.json', import.meta.url), 'utf8'));

async function usedKeys() {
  const keys = new Set();
  for (const entry of await readdir(clientDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.js') || entry.name === 'styles.js') continue;
    const source = await readFile(new URL(entry.name, clientDir), 'utf8');
    for (const match of source.matchAll(/\bt\('([^']+)'/g)) keys.add(match[1]);
  }
  return keys;
}

test('every literal translation key exists in both dictionaries', async () => {
  const keys = await usedKeys();
  assert.ok(keys.size > 0);
  assert.deepEqual([...keys].filter((key) => !(key in en.ui)), []);
  assert.deepEqual([...keys].filter((key) => !(key in zh.ui)), []);
});

test('translation values are non-empty strings', () => {
  for (const [language, dictionary] of [['en', en], ['zh', zh]]) {
    for (const [key, value] of Object.entries(dictionary.ui)) {
      assert.equal(typeof value, 'string', `${language}.${key}`);
      assert.ok(value.length > 0, `${language}.${key}`);
    }
  }
});
