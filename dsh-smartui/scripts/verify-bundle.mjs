import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
for (const target of Object.values(manifest.exports)) {
  if (target.includes('*')) continue;
  assert.ok((await stat(new URL(target, root))).isFile(), `Missing export: ${target}`);
}
let registration;
const source = await readFile(new URL('dist/client.js', root), 'utf8');
runInNewContext(source, { window: { __ModuleLoader__: { load(value) { assert.equal(registration, undefined); registration = value; } } } }, { timeout: 2_000 });
assert.equal(registration?.id, manifest.name);
const imports = [];
const plugin = registration.factory(name => {
  imports.push(name);
  assert.equal(name, 'react', 'Client must import only the host React module');
  return React;
});
assert.deepEqual([...new Set(imports)], ['react']);
assert.equal(typeof plugin.apply, 'function');
assert.ok(plugin.inject.includes('slots'));
assert.ok(plugin.inject.includes('uiConversation'), 'The Turn-level row needs the Conversation Definition registry');
// Contract smoke test, not live DSH or visual verification.
const cleanups = [];
const locales = new Set();
const slots = new Set();
const definitions = new Set();
const form = { getSnapshot: () => ({ status: 'loading', value: undefined, writable: false }), subscribe: () => () => {} };
const ctx = {
  effect(factory) { const dispose = factory(); cleanups.push(dispose); return dispose; },
  locale: { register(ns, locale) { const key = `${ns}:${locale}`; assert.ok(!locales.has(key)); locales.add(key); return () => locales.delete(key); }, bind: () => key => key },
  configForms: { get: id => { assert.equal(id, 'dsh-smartui'); return form; } },
  theme: { overrideTokens() { throw new Error('No theme should activate before Host settings are accepted'); } },
  uiConversation: {
    events: {
      register(definition) {
        assert.equal(definition.kind, 'smartui-document'); assert.equal(definition.target, 'chat');
        assert.ok(!definitions.has(definition.kind)); definitions.add(definition.kind);
        return () => definitions.delete(definition.kind);
      },
    },
  },
  slots: {
    inject(name, factory) { const dispose = factory(); cleanups.push(dispose); return dispose; },
    register(options, component) { const key = `${options.name}:${options.key ?? options.id}`; assert.ok(!slots.has(key)); assert.equal(typeof component, 'function'); slots.add(key); return () => slots.delete(key); },
  },
};
plugin.apply(ctx);
assert.equal(slots.size, 4); assert.equal(locales.size, 2); assert.equal(definitions.size, 1);
cleanups.reverse().forEach(dispose => dispose());
assert.equal(slots.size, 0); assert.equal(locales.size, 0); assert.equal(definitions.size, 0);
console.log('Bundle contract verified: lazy factory, host React only, exported resources, registration and cleanup. Live DSH/browser verification remains separate.');
