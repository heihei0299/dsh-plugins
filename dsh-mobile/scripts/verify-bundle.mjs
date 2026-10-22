import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));

// 1. Every exported resource the plugin manager or the loader reads must exist.
for (const target of Object.values(manifest.exports)) {
  if (target.includes('*')) continue;
  assert.ok((await stat(new URL(target, root))).isFile(), `Missing export: ${target}`);
}

// 2. The client artifact is a lazy factory registration, not an application.
let registration;
const source = await readFile(new URL('dist/client.js', root), 'utf8');
runInNewContext(source, { window: { __ModuleLoader__: { load(value) { assert.equal(registration, undefined, 'the bundle must register exactly one factory'); registration = value; } } } }, { timeout: 2_000 });
assert.equal(registration?.id, manifest.name);

// 3. The factory may only reach the host React module (the module-table baseline).
const imports = [];
const plugin = registration.factory(name => {
  imports.push(name);
  assert.equal(name, 'react', 'the client bundle must import only the host React module');
  return React;
});
assert.deepEqual([...new Set(imports)], ['react']);
assert.equal(typeof plugin.apply, 'function');
for (const service of ['slots', 'locale', 'configForms', 'layout', 'sessions', 'jobs', 'uiWorkspace']) {
  assert.ok(plugin.inject.includes(service), `the client half must inject "${service}"`);
}

// 4. Host DOM landmarks the stylesheet depends on must survive into the artifact.
//    This is the mechanical half of the compatibility contract documented in
//    src/client/landmarks.ts: a host rename fails here instead of silently
//    producing a plugin that does nothing.
//    `data-conversation-tabs` is intentionally absent: the View tabs are measured
//    by the probe but deliberately not resized (see landmarks.ts), so tree-shaken
//    bundles are allowed to drop the selector.
const LANDMARKS = [
  '[data-slot="root"]',
  '[data-slot="sidebar"]',
  '[data-composer-card]',
  '[data-composer-dock]',
  '[data-composer-input]',
  '[data-conversation-scroll]',
  '[data-actions-reveal]',
  '[data-sidebar-collapsed]',
  '[data-slot="conversation.session.header.actions"]',
  'data-dsh-mobile-badges',
  '.md-table-wide',
];
for (const landmark of LANDMARKS) assert.ok(source.includes(landmark), `the client bundle lost host landmark ${landmark}`);

// 5. The sheet must never pull remote resources into the DSH page.
assert.ok(!/\burl\s*\(/i.test(source), 'the stylesheet must not reference external resources');
assert.ok(!/@import\b/i.test(source), 'the stylesheet must not import another stylesheet');

// 6. Registration and teardown contract, with a stand-in host.
//
// The factory runs inside a fresh VM context, so the fake document has to be
// installed THERE, not on this module's globals — the bundle sees only its own
// sandbox.
const cleanups = [];
const locales = new Set();
const slots = new Set();
const forms = new Set();
const styles = new Set();
const attributes = new Set();
const sandboxDocument = {
  documentElement: {
    setAttribute: name => { attributes.add(name); },
    removeAttribute: name => { attributes.delete(name); },
    style: { setProperty() {}, removeProperty() {} },
  },
  head: {
    appendChild: node => { styles.add(node.name ?? 'style'); },
    querySelector: () => null,
  },
  createElement: () => {
    const tag = {
      name: undefined,
      setAttribute(key, value) { if (key === 'data-plugin-css') tag.name = value; },
      getAttribute: key => (key === 'data-plugin-css' ? tag.name ?? null : null),
      remove() { styles.delete(tag.name ?? 'style'); },
      textContent: '', removeAttribute() {}, appendChild() {},
    };
    return tag;
  },
  querySelector: () => null,
};
const form = {
  getSnapshot: () => ({ status: 'ready', value: { mode: 'on', drawerNavigation: true, comfortableTargets: true }, writable: true, revision: 1 }),
  subscribe: listener => { forms.add(listener); return () => { forms.delete(listener); }; },
  set: async () => true,
};
const ctx = {
  effect(factory) { const dispose = factory(); cleanups.push(dispose); return dispose; },
  locale: {
    register(ns, locale) { const key = `${ns}:${locale}`; assert.ok(!locales.has(key)); locales.add(key); return () => locales.delete(key); },
    bind: () => key => key, getSnapshot: () => ({ active: 'en', revision: 0 }), subscribe: () => () => {},
  },
  configForms: { get: id => { assert.equal(id, 'dsh-mobile'); return form; } },
  layout: {
    toggleSidebar() {},
    panelInfo: { getSnapshot: () => ({ activePanelId: null }), subscribe: () => () => {} },
  },
  sessions: { list: { getSnapshot: () => ({ byId: {} }), subscribe: () => () => {} } },
  jobs: {
    state: { getSnapshot: () => ({ rows: {} }), subscribe: () => () => {} },
    watchRows: () => () => {},
  },
  slots: {
    inject(name, factory) { const dispose = factory(); cleanups.push(dispose); return dispose; },
    register(options) { const key = `${options.name}:${options.key ?? options.id}`; assert.ok(!slots.has(key), `duplicate slot registration ${key}`); slots.add(key); return () => slots.delete(key); },
  },
};
// Re-materialize the factory against a sandbox that provides the browser globals
// the plugin touches; the VM context is what the real loader would look like.
const sandboxRegistration = (() => {
  let captured;
  runInNewContext(source, {
    window: { __ModuleLoader__: { load(value) { captured = value; } } },
    document: sandboxDocument,
    innerHeight: 800,
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    MutationObserver: class { observe() {} disconnect() {} },
    visualViewport: undefined,
  }, { timeout: 2_000 });
  return captured;
})();
const sandboxPlugin = sandboxRegistration.factory(name => {
  assert.equal(name, 'react');
  return React;
});
sandboxPlugin.apply(ctx);
assert.equal(slots.size, 4, 'the plugin registers the header toggle, the scrim, the status badges and the settings row');
assert.equal(locales.size, 2, 'both dictionaries are registered');
assert.ok(attributes.has('data-dsh-mobile'), 'activation marks the document root');
cleanups.reverse().forEach(dispose => dispose());
assert.equal(slots.size, 0);
assert.equal(locales.size, 0);
assert.equal(attributes.size, 0, 'teardown removes the root attribute');
assert.equal(styles.size, 0, 'teardown removes every style tag it added');

console.log('Bundle verified: lazy factory, host React only, exported resources, landmark contract, registration and teardown. Live browser verification remains separate.');
