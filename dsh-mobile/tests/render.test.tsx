import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import en from '../locale/en.json' with { type: 'json' };
import zh from '../locale/zh.json' with { type: 'json' };
import { ActivationContext, EnvironmentContext, type Environment } from '../src/client/environment.js';
import { DrawerScrim, DrawerToggle } from '../src/client/Drawer.js';
import { Settings } from '../src/client/Settings.js';
import { DEFAULT_SETTINGS, type MobileSettings } from '../src/shared/types.js';
import type { ClientContext, ConfigSnapshot } from '../src/client/contracts.js';

const locale = { active: 'en', revision: 0 };
function environment(calls: string[]): Environment {
  return {
    ctx: {
      locale: { getSnapshot: () => locale, subscribe: () => () => {} },
      layout: { toggleSidebar: () => { calls.push('toggleSidebar'); } },
    } as unknown as ClientContext,
    form: { getSnapshot: () => snapshot, subscribe: () => () => {}, set: async () => true },
    t: (key, values) => {
      let text = (en.ui as Record<string, string>)[key] ?? key;
      for (const [name, value] of Object.entries(values ?? {})) text = text.replaceAll(`{${name}}`, String(value));
      return text;
    },
  };
}
let snapshot: ConfigSnapshot = { status: 'ready', value: { ...DEFAULT_SETTINGS }, writable: true, revision: 1 };

function render(node: React.ReactNode, active: boolean, settings: MobileSettings | undefined, drawerClosed: boolean) {
  return renderToStaticMarkup(
    <EnvironmentContext.Provider value={environment([])}>
      <ActivationContext.Provider value={{ active, settings, drawerClosed }}>{node}</ActivationContext.Provider>
    </EnvironmentContext.Provider>,
  );
}

test('nothing renders while the mobile layout is inactive', () => {
  const html = render(<><DrawerScrim /><DrawerToggle /></>, false, undefined, true);
  assert.equal(html, '');
});

test('drawer mode renders a toggle and the scrim only when the drawer is open', () => {
  const closed = render(<><DrawerScrim /><DrawerToggle /></>, true, { ...DEFAULT_SETTINGS }, true);
  assert.match(closed, /class="dsh-mobile-toggle"/);
  assert.doesNotMatch(closed, /dsh-mobile-scrim/);
  assert.match(closed, /aria-expanded="false"/);
  assert.match(closed, /aria-label="Open navigation"/);

  const open = render(<><DrawerScrim /><DrawerToggle /></>, true, { ...DEFAULT_SETTINGS }, false);
  assert.match(open, /class="dsh-mobile-scrim"/);
  assert.match(open, /aria-expanded="true"/);
  assert.match(open, /aria-label="Close navigation"/);
});

test('without drawer navigation the plugin adds no control at all', () => {
  const html = render(<><DrawerScrim /><DrawerToggle /></>, true, { ...DEFAULT_SETTINGS, drawerNavigation: false }, true);
  assert.equal(html, '');
});

test('the toggle is a real button with an accessible name, not a div with a handler', () => {
  const html = render(<DrawerToggle />, true, { ...DEFAULT_SETTINGS }, true);
  assert.match(html, /^<button type="button"/);
  assert.match(html, /aria-controls="dsh-mobile-drawer"/);
  assert.match(html, /<svg[^>]*aria-hidden="true"/);
});

test('settings exposes all three fields and the current values', () => {
  snapshot = { status: 'ready', value: { mode: 'off', drawerNavigation: false, comfortableTargets: true }, writable: true, revision: 3 };
  const html = render(<Settings />, false, undefined, true);
  assert.match(html, /Mobile experience/);
  assert.equal(html.match(/<select/g)?.length, 3);
  assert.match(html, /<option value="off" selected="">Off<\/option>/);
  assert.doesNotMatch(html, /<option value="on" selected="">Off<\/option>/);
});

test('read-only and unavailable settings disable every control and say why', () => {
  snapshot = { status: 'ready', value: { ...DEFAULT_SETTINGS }, writable: false, revision: 1 };
  const readOnly = render(<Settings />, false, undefined, true);
  assert.equal(readOnly.match(/disabled=""/g)?.length, 3);
  assert.match(readOnly, /read-only/);
  snapshot = { status: 'unavailable', value: undefined, writable: false, revision: undefined };
  const unavailable = render(<Settings />, false, undefined, true);
  assert.equal(unavailable.match(/disabled=""/g)?.length, 3);
  assert.match(unavailable, /serves no mobile settings/);
  snapshot = { status: 'loading', value: undefined, writable: false, revision: undefined };
  assert.match(render(<Settings />, false, undefined, true), /Reading this profile/);
});

test('translations have matching keys and interpolation placeholders', () => {
  assert.deepEqual(Object.keys(en.ui).sort(), Object.keys(zh.ui).sort());
  for (const key of Object.keys(en.ui) as (keyof typeof en.ui)[]) {
    assert.deepEqual(en.ui[key].match(/\{[^}]+\}/g), zh.ui[key].match(/\{[^}]+\}/g), `placeholder mismatch in ${key}`);
  }
  assert.ok(en.meta.title && zh.meta.title && en.meta.description && zh.meta.description);
});
