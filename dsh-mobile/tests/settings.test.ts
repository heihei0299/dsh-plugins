import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Config } from '../src/host/index.js';
import { DEFAULT_SETTINGS, NARROW_BREAKPOINT, readSettings, resolveEnabled, type MobileSettings } from '../src/shared/types.js';

test('the Host schema defaults and readSettings share one source', () => {
  const config = (Config as unknown as (value: object) => Record<keyof MobileSettings, { get(): unknown }>)({});
  const fields = ['mode', 'drawerNavigation', 'comfortableTargets', 'swipeNavigation', 'rowActionsOnTouch', 'quietComposerFocus'] as const;
  for (const field of fields) {
    assert.equal(config[field].get(), DEFAULT_SETTINGS[field], `${field} schema default`);
    assert.equal(readSettings(undefined)[field], DEFAULT_SETTINGS[field], `${field} readSettings fallback`);
  }
  // Every declared field is covered above, so a new setting cannot ship with an
  // untested default.
  assert.deepEqual([...fields].sort(), Object.keys(DEFAULT_SETTINGS).sort());
});

test('readSettings falls back to defaults instead of trusting the wire', () => {
  assert.deepEqual(readSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(readSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(readSettings({}), DEFAULT_SETTINGS);
  // A hand-patched profile must not be able to introduce a fourth mode.
  assert.equal(readSettings({ mode: 'always' }).mode, 'auto');
  assert.equal(readSettings({ mode: 42 }).mode, 'auto');
  assert.equal(readSettings({ drawerNavigation: 'yes' }).drawerNavigation, true);
  assert.equal(readSettings({ comfortableTargets: 0 }).comfortableTargets, true);
  assert.equal(readSettings({ swipeNavigation: 'no' }).swipeNavigation, true);
  assert.equal(readSettings({ rowActionsOnTouch: null }).rowActionsOnTouch, true);
  assert.equal(readSettings({ quietComposerFocus: 1 }).quietComposerFocus, true);
  assert.deepEqual(readSettings({ mode: 'off', drawerNavigation: false, comfortableTargets: false }), {
    mode: 'off', drawerNavigation: false, comfortableTargets: false,
    swipeNavigation: true, rowActionsOnTouch: true, quietComposerFocus: true,
  });
  assert.deepEqual(readSettings({ swipeNavigation: false, rowActionsOnTouch: false, quietComposerFocus: false }), {
    ...DEFAULT_SETTINGS, swipeNavigation: false, rowActionsOnTouch: false, quietComposerFocus: false,
  });
});

test('mode on/off are absolute and mode auto follows the device', () => {
  const narrow = { viewportWidth: 390, coarsePointer: false };
  const wide = { viewportWidth: 1440, coarsePointer: false };
  const touchLaptop = { viewportWidth: 1440, coarsePointer: true };
  const withMode = (mode: MobileSettings['mode']): MobileSettings => ({ ...DEFAULT_SETTINGS, mode });

  assert.equal(resolveEnabled(withMode('auto'), narrow), true);
  assert.equal(resolveEnabled(withMode('auto'), wide), false);
  assert.equal(resolveEnabled(withMode('auto'), touchLaptop), true);
  assert.equal(resolveEnabled(withMode('on'), wide), true);
  assert.equal(resolveEnabled(withMode('off'), narrow), false);
  assert.equal(resolveEnabled(withMode('off'), touchLaptop), false);
});

test('the narrow boundary is inclusive and matches the documented breakpoint', () => {
  const at = { viewportWidth: NARROW_BREAKPOINT, coarsePointer: false };
  const above = { viewportWidth: NARROW_BREAKPOINT + 1, coarsePointer: false };
  assert.equal(resolveEnabled({ ...DEFAULT_SETTINGS }, at), true);
  assert.equal(resolveEnabled({ ...DEFAULT_SETTINGS }, above), false);
});
