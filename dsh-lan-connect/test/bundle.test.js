import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, stat } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const localeEn = JSON.parse(await readFile(new URL('locale/en.json', root), 'utf8'));
const localeZh = JSON.parse(await readFile(new URL('locale/zh.json', root), 'utf8'));

/** The wire global the Host injects; the bundle reads it at render time. */
const BOOTSTRAP_KEY = '__DSH_LAN_CONNECT__';

/**
 * Assert a file exists and is a regular file.
 * @param relative - package-relative path.
 */
async function assertFile(relative) {
  const info = await stat(new URL(relative, root));
  assert.ok(info.isFile(), `${relative} must be a file`);
}

/**
 * Load the built bundle in a VM window facade and return its single registration.
 * @returns the registration object captured from `__ModuleLoader__.load`.
 */
async function loadRegistration() {
  const source = await readFile(new URL('dist/client.js', root), 'utf8');
  let registration;
  let loads = 0;
  const sandbox = {
    // The factory runs in this context later, so it needs the browser globals
    // its pure helpers touch. URL is the only one the card needs to parse the
    // injected record; the QR encoder stays in the bundle.
    URL,
    window: {
      __ModuleLoader__: {
        load(value) {
          loads += 1;
          registration = value;
        },
      },
    },
  };
  runInNewContext(source, sandbox, { timeout: 2_000 });
  assert.equal(loads, 1, 'the bundle registers exactly one factory');
  return { registration, source, sandbox };
}

test('the development build exists and every declared package export resolves', async () => {
  await assertFile('index.js');
  await assertFile('dist/client.js');
  await assertFile('cordis.patch.yml');
  await assertFile('assets/icon.svg');
  await assertFile('README.md');
  await assertFile('LICENSE');
  await assertFile('locale/en.json');
  await assertFile('locale/zh.json');
  for (const [subpath, target] of Object.entries(manifest.exports)) {
    if (target.includes('*')) continue;
    await assertFile(target);
    assert.ok(subpath.startsWith('.'), subpath);
  }
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(manifest.dsh.client.platform, 'web');
  assert.deepEqual(manifest.dsh.client.inject, ['@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-ui-settings']);
  assert.equal(manifest.engines.dsh, '0.2.1-rc.2');
  for (const file of ['index.js', 'dist/client.js', 'cordis.patch.yml', 'assets/icon.svg', 'locale/*.json', 'README.md', 'LICENSE']) {
    assert.ok(manifest.files.includes(file), `files must deliver ${file}`);
  }
});

test('the bundle is one lazy factory that reaches only the host React module', async () => {
  const { registration, source } = await loadRegistration();
  assert.equal(registration.id, manifest.name);
  assert.equal(typeof registration.factory, 'function');
  assert.equal(registration.chunk, undefined);
  assert.match(source, /Bundled third-party software: qrcode-generator/);
  assert.match(source, /Copyright \(c\) 2009 Kazuhiko Arase/);
  assert.match(source, /MIT License/);
  const requested = [];
  const plugin = registration.factory(name => {
    requested.push(name);
    assert.equal(name, 'react', 'the client bundle may only request the host React module');
    return React;
  });
  assert.deepEqual([...new Set(requested)], ['react']);
  assert.equal(typeof plugin.apply, 'function');
  assert.deepEqual([...plugin.inject], ['slots', 'locale']);
  assert.equal(typeof plugin.LOCALE_NS, 'string');
  assert.doesNotMatch(source, /document\.cookie|localStorage|sessionStorage|XMLHttpRequest/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|innerHTML\s*=/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /https?:\/\/[^"'\\\s]*(qr|chart|api)/i, 'no remote service may be used by the client');
});

test('the bundle registers dictionaries and one settings row, renders, and tears down', async () => {
  const { registration, sandbox } = await loadRegistration();
  const plugin = registration.factory(() => React);
  const previous = sandbox[BOOTSTRAP_KEY];
  sandbox[BOOTSTRAP_KEY] = {
    entryUrl: 'http://192.168.1.62:50020/lan',
    host: '192.168.1.62',
    port: 50020,
    protocol: 'http:',
    loopback: false,
    lanAddresses: [{ name: 'wlan0', address: '192.168.1.62', bound: true }],
  };
  const cleanups = [];
  const locales = new Set();
  const registrations = [];
  const ctx = {
    effect(factory) { const dispose = factory(); cleanups.push(dispose); return dispose; },
    locale: {
      register(ns, language) { const key = `${ns}:${language}`; assert.ok(!locales.has(key)); locales.add(key); return () => locales.delete(key); },
      bind: () => key => localeEn.ui[key] ?? key,
      getSnapshot: () => ({ active: 'en', revision: 0 }),
      subscribe: () => () => {},
    },
    slots: {
      inject(name, factory) { assert.equal(name, 'settings.general.item'); const dispose = factory(); cleanups.push(dispose); return dispose; },
      register(options, component) { registrations.push({ options, component }); return () => { registrations.pop(); }; },
    },
  };
  try {
    plugin.apply(ctx);
    assert.equal(locales.size, 2);
    assert.equal(registrations.length, 1);
    assert.equal(registrations[0].options.id, 'dsh-lan-connect');
    assert.equal(registrations[0].options.order, 90);
    const html = renderToStaticMarkup(React.createElement(registrations[0].component));
    assert.match(html, /data-lan-connect="root"/);
    assert.match(html, /http:\/\/192\.168\.1\.62:50020\/lan/);
    assert.match(html, /data-lan-connect="qr-image"/);
    assert.match(html, /src="data:image\/gif;base64,/);
    assert.doesNotMatch(html, /\?token=/);
    cleanups.reverse().forEach(dispose => dispose());
    assert.equal(locales.size, 0);
    assert.equal(registrations.length, 0);
  } finally {
    if (previous === undefined) delete sandbox[BOOTSTRAP_KEY];
    else sandbox[BOOTSTRAP_KEY] = previous;
  }
});

test('the bundle patch only inserts the plugin entry and never overrides native rows', async () => {
  const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8');
  assert.match(patch, /^- insert:\s*$/m);
  assert.match(patch, /^\s+- id: dsh-lan-connect\s*$/m);
  assert.match(patch, /^\s+name: '@local\/dsh-lan-connect'\s*$/m);
  const code = patch.split('\n').filter(line => !line.trim().startsWith('#')).join('\n');
  assert.doesNotMatch(code, /^- (?!insert:)\S/m, 'no top-level patch operation other than insert');
  assert.doesNotMatch(code, /\bremove\b|\boverride\b|\bconfig\b/im);
  const inserts = code.split('\n').filter(line => /^- insert:/.test(line));
  assert.equal(inserts.length, 1);
  const entries = patch.split('\n').filter(line => /^\s+- id:/.test(line));
  assert.deepEqual(entries.map(line => line.trim()), ['- id: dsh-lan-connect']);
});

test('both locale dictionaries carry plugin metadata and the same UI key set', () => {
  for (const dictionary of [localeEn, localeZh]) {
    assert.ok(dictionary.meta.title.trim().length > 0);
    assert.ok(dictionary.meta.description.trim().length > 0);
  }
  assert.deepEqual(Object.keys(localeZh.ui).sort(), Object.keys(localeEn.ui).sort());
  for (const key of ['entry.normal', 'entry.proxy', 'qr.title', 'notice.cookies', 'copy.manual', 'copy.unavailable', 'warn.http', 'warn.loopback', 'lan.entry']) {
    assert.equal(typeof localeEn.ui[key], 'string', key);
    assert.equal(typeof localeZh.ui[key], 'string', key);
  }
});
