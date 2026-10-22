import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  BOOTSTRAP_KEY, LanConnectCard, LOCALE_NS, SETTINGS_ID, SETTINGS_ORDER, SETTINGS_SLOT,
  copyEntryLink, copyLinkText, createQrDataUrl, lanSuggestUrl, readBootstrap, selectLinkText,
} from '../src/client.js';
import en from '../locale/en.json' with { type: 'json' };
import zh from '../locale/zh.json' with { type: 'json' };

const ENTRY = 'http://192.168.1.62:50020/lan';

/**
 * The Host metadata shape for a typical LAN bind.
 * @returns a clean injected record.
 */
function validBootstrap() {
  return {
    entryUrl: ENTRY,
    host: '192.168.1.62',
    port: 50020,
    protocol: 'http:',
    loopback: false,
    lanAddresses: [
      { name: 'wlan0', address: '192.168.1.62', bound: true },
      { name: 'docker0', address: '172.17.0.1', bound: false },
    ],
  };
}

/** English dictionary lookup for rendering. */
const t = key => en.ui[key] ?? key;

test('reads only a clean, consistent Host record and drops forged candidates', () => {
  const record = readBootstrap(validBootstrap());
  assert.ok(record);
  assert.equal(record.entryUrl, ENTRY);
  assert.deepEqual(record.lanAddresses.map(item => item.address), ['192.168.1.62', '172.17.0.1']);
  assert.ok(Object.isFrozen(record));
  assert.ok(Object.isFrozen(record.lanAddresses));

  const forged = [
    { ...validBootstrap(), entryUrl: `${ENTRY}?token=stolen` },
    { ...validBootstrap(), entryUrl: `${ENTRY}#fragment` },
    { ...validBootstrap(), entryUrl: 'http://user:password@192.168.1.62:50020/lan' },
    { ...validBootstrap(), entryUrl: 'http://192.168.1.62:50020/elsewhere' },
    { ...validBootstrap(), entryUrl: 'file:///tmp/lan' },
    { ...validBootstrap(), protocol: 'ftp:' },
    { ...validBootstrap(), port: 0 },
    { ...validBootstrap(), port: '50020' },
    { ...validBootstrap(), host: '   ' },
    { ...validBootstrap(), loopback: 'no' },
    { ...validBootstrap(), lanAddresses: '192.168.1.62' },
    null, undefined, 'record', [],
  ];
  for (const value of forged) assert.equal(readBootstrap(value), null, JSON.stringify(value));

  const mixed = readBootstrap({
    ...validBootstrap(),
    lanAddresses: [
      { name: 'public', address: '203.0.113.7', bound: false },
      { name: 'loopback', address: '127.0.0.1', bound: false },
      { name: 'bad', address: '192.168.1.62@attacker.invalid', bound: false },
      { name: 'missing', address: '10.0.0.2' },
      { name: 'valid', address: '10.0.0.3', bound: false },
    ],
  });
  assert.deepEqual(mixed.lanAddresses, [{ name: 'valid', address: '10.0.0.3', bound: false }]);
});

test('accepts an advertised HTTPS proxy root while reporting the real listener protocol', () => {
  const record = readBootstrap({
    ...validBootstrap(),
    entryUrl: 'https://dsh.example.test/ui/lan',
    protocol: 'http:',
  });
  assert.ok(record);
  assert.equal(record.protocol, 'http:');
  assert.equal(record.advertisedProtocol, 'https:');
  assert.equal(record.advertisedPort, 443);
  assert.equal(record.entryUrl, 'https://dsh.example.test/ui/lan');
  const html = renderToStaticMarkup(React.createElement(LanConnectCard, { t, bootstrap: record }));
  assert.match(html, /value="https:\/\/dsh\.example\.test\/ui\/lan"/);
  assert.doesNotMatch(html, /data-lan-connect="warn-http"/, 'the browser hop is HTTPS even though the listener is plain HTTP');
});

test('warns about reachability only when the advertised entry is loopback', () => {
  const proxied = readBootstrap({
    ...validBootstrap(),
    entryUrl: 'http://192.168.1.62:50020/lan',
    host: '127.0.0.1',
    port: 3080,
    loopback: true,
  });
  assert.equal(proxied.loopback, true);
  assert.equal(proxied.advertisedLoopback, false);
  const html = renderToStaticMarkup(React.createElement(LanConnectCard, { t, bootstrap: proxied }));
  assert.doesNotMatch(html, /data-lan-connect="warn-loopback"/);
  assert.match(html, /data-lan-connect="info-proxy"/);
  assert.match(html, /127\.0\.0\.1:3080/);
  assert.match(html, /192\.168\.1\.62/);
});

test('suggests a LAN URL by replacing only a validated private IPv4 host', () => {
  const record = readBootstrap(validBootstrap());
  assert.equal(lanSuggestUrl(record, '192.168.1.63'), 'http://192.168.1.63:50020/lan');
  assert.equal(lanSuggestUrl(record, ' 10.1.2.3 '), 'http://10.1.2.3:50020/lan');
  const mounted = readBootstrap({ ...validBootstrap(), entryUrl: 'https://dsh.example.test/ui/lan', protocol: 'https:' });
  assert.equal(lanSuggestUrl(mounted, '10.1.2.3'), 'https://10.1.2.3/ui/lan');
  for (const address of ['203.0.113.7', '0.0.0.0', '[::1]', '127.0.0.1', '192.168.1.62@attacker.invalid', '192.168.1.62/x', '']) {
    assert.equal(lanSuggestUrl(record, address), null, address);
  }
  assert.equal(lanSuggestUrl({ entryUrl: 'http://host/lan?token=fixture' }, '10.0.0.1'), null);
});

test('QR data URL is generated locally, stable per entry URL, and not a remote image', () => {
  const first = createQrDataUrl(ENTRY);
  assert.match(first, /^data:image\/gif;base64,[A-Za-z0-9+/=]+$/);
  assert.equal(createQrDataUrl(ENTRY), first, 'the same URL produces the same image');
  assert.notEqual(createQrDataUrl(`${ENTRY.replace('/lan', '')}/lan?x=1`), first);
  assert.equal(createQrDataUrl(''), null);
  assert.equal(createQrDataUrl(null), null);
  assert.equal(createQrDataUrl(42), null);
});

test('renders a read-only entry link, listener facts, warnings, and a local QR image', () => {
  const html = renderToStaticMarkup(React.createElement(LanConnectCard, { t, bootstrap: readBootstrap(validBootstrap()) }));
  assert.match(html, /data-lan-connect="root"/);
  assert.match(html, /data-lan-connect="entry-normal-input"/);
  assert.match(html, /value="http:\/\/192\.168\.1\.62:50020\/lan"/);
  assert.match(html, /readOnly=""/);
  assert.match(html, /data-lan-connect="facts"/);
  assert.match(html, /192\.168\.1\.62/);
  assert.match(html, /data-lan-connect="warn-http"/);
  assert.match(html, /data-lan-connect="qr-image"/);
  assert.match(html, /src="data:image\/gif;base64,/);
  assert.match(html, /data-lan-connect="lan-candidate"/);
  assert.match(html, /data-lan-connect="cookies"/);
  assert.doesNotMatch(html, /\?token=|stolen|fixture/);
  assert.doesNotMatch(html, /https?:\/\/[^"]*qr/i, 'no external QR service');
});

test('renders unavailable and loopback states without inventing an entry URL', () => {
  for (const bootstrap of [null, undefined]) {
    const html = renderToStaticMarkup(React.createElement(LanConnectCard, { t, bootstrap }));
    assert.match(html, /data-lan-connect="unavailable"/);
    assert.doesNotMatch(html, /data-lan-connect="entry-normal-input"/);
    assert.doesNotMatch(html, /data-lan-connect="qr-image"/);
  }
  const html = renderToStaticMarkup(React.createElement(LanConnectCard, {
    t,
    bootstrap: readBootstrap({
      ...validBootstrap(),
      entryUrl: 'http://127.0.0.1:50020/lan',
      host: '127.0.0.1',
      loopback: true,
      lanAddresses: [],
    }),
  }));
  assert.match(html, /data-lan-connect="warn-loopback"/);
  assert.match(html, /loopback-only|loopback address/i);
  assert.match(html, /data-lan-connect="lan"/);
});

test('React escapes candidate interface names instead of trusting global metadata', () => {
  const html = renderToStaticMarkup(React.createElement(LanConnectCard, {
    t,
    bootstrap: readBootstrap({
      ...validBootstrap(),
      lanAddresses: [{ name: '"><script>alert(1)</script>', address: '10.0.0.4', bound: false }],
    }),
  }));
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test('clipboard success is reported only after writeText resolves; manual fallback is explicit', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const install = clipboard => {
    Object.defineProperty(globalThis, 'navigator', { value: { clipboard }, configurable: true });
  };
  try {
    install(undefined);
    assert.equal(await copyEntryLink(ENTRY, null), 'copy.failed');
    assert.equal(await copyLinkText(ENTRY), false);
    const input = { focus() {}, select() {}, setSelectionRange() {}, value: ENTRY };
    assert.equal(await copyEntryLink(ENTRY, input), 'copy.unavailable', 'an absent Clipboard API is distinguished from a refusal');

    let written = null;
    install({ async writeText(value) { written = value; } });
    assert.equal(await copyEntryLink(ENTRY, null), 'copy.copied');
    assert.equal(written, ENTRY);
    assert.equal(await copyLinkText(''), false);

    install({ async writeText() { throw new Error('denied'); } });
    assert.equal(await copyEntryLink(ENTRY, input), 'copy.manual', 'a rejected write selects the field instead of claiming success');
    assert.equal(await copyEntryLink(ENTRY, null), 'copy.failed');
  } finally {
    if (original !== undefined) Object.defineProperty(globalThis, 'navigator', original);
  }
});

test('selectLinkText focuses, selects, and fails closed on a broken field', () => {
  let focused = false;
  let selected = false;
  const input = {
    value: ENTRY,
    focus() { focused = true; },
    select() { selected = true; },
    setSelectionRange(start, end) { assert.equal(start, 0); assert.equal(end, ENTRY.length); },
  };
  assert.equal(selectLinkText(input), true);
  assert.equal(focused, true);
  assert.equal(selected, true);
  assert.equal(selectLinkText(null), false);
  assert.equal(selectLinkText({ value: ENTRY, focus() { throw new Error('detached'); } }), false);
});

test('registers both dictionaries and one settings row, then removes both on teardown', async () => {
  const original = globalThis[BOOTSTRAP_KEY];
  const cleanups = [];
  const locales = new Map();
  const registrations = [];
  const ctx = {
    effect(factory) { const dispose = factory(); cleanups.push(dispose); return dispose; },
    locale: {
      register(ns, language, dictionary) {
        const key = `${ns}:${language}`;
        assert.equal(locales.has(key), false);
        locales.set(key, dictionary);
        return () => locales.delete(key);
      },
      bind: () => t,
      getSnapshot: () => ({ active: 'en', revision: 0 }),
      subscribe: () => () => {},
    },
    slots: {
      inject(name, factory) { assert.equal(name, SETTINGS_SLOT); const dispose = factory(); cleanups.push(dispose); return dispose; },
      register(options, component) {
        registrations.push({ options, component });
        return () => { registrations.pop(); };
      },
    },
  };
  globalThis[BOOTSTRAP_KEY] = validBootstrap();
  try {
    const plugin = await import('../src/client.js');
    plugin.apply(ctx);
    assert.deepEqual([...locales.keys()].sort(), [`${LOCALE_NS}:en`, `${LOCALE_NS}:zh`]);
    assert.equal(registrations.length, 1);
    assert.equal(registrations[0].options.name, SETTINGS_SLOT);
    assert.equal(registrations[0].options.id, SETTINGS_ID);
    assert.equal(registrations[0].options.order, SETTINGS_ORDER);
    const rendered = renderToStaticMarkup(React.createElement(registrations[0].component));
    assert.match(rendered, /data-lan-connect="entry-normal-input"/);
    assert.match(rendered, /192\.168\.1\.62:50020\/lan/);
    cleanups.reverse().forEach(dispose => dispose());
    assert.equal(locales.size, 0);
    assert.equal(registrations.length, 0);
  } finally {
    if (original === undefined) delete globalThis[BOOTSTRAP_KEY];
    else globalThis[BOOTSTRAP_KEY] = original;
  }
});

test('locale dictionaries expose the same UI keys and plugin meta', () => {
  const enKeys = Object.keys(en.ui).sort();
  const zhKeys = Object.keys(zh.ui).sort();
  assert.deepEqual(zhKeys, enKeys, 'both dictionaries must cover the same keys');
  for (const [language, dictionary] of [['en', en], ['zh', zh]]) {
    assert.equal(typeof dictionary.meta.title, 'string', `${language} meta.title`);
    assert.equal(typeof dictionary.meta.description, 'string', `${language} meta.description`);
    assert.ok(dictionary.meta.title.trim().length > 0);
    assert.ok(dictionary.meta.description.trim().length > 0);
    for (const key of enKeys) assert.ok(dictionary.ui[key].trim().length > 0, `${language} ${key}`);
  }
});
