import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, NARROW_BREAKPOINT, readSettings, resolveEnabled, type MobileSettings } from '../src/shared/types.js';

test('readSettings falls back to defaults instead of trusting the wire', () => {
  assert.deepEqual(readSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(readSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(readSettings({}), DEFAULT_SETTINGS);
  // A hand-patched profile must not be able to introduce a fourth mode.
  assert.equal(readSettings({ mode: 'always' }).mode, 'auto');
  assert.equal(readSettings({ mode: 42 }).mode, 'auto');
  assert.equal(readSettings({ drawerNavigation: 'yes' }).drawerNavigation, true);
  assert.equal(readSettings({ comfortableTargets: 0 }).comfortableTargets, true);
  assert.deepEqual(readSettings({ mode: 'off', drawerNavigation: false, comfortableTargets: false }), {
    mode: 'off', drawerNavigation: false, comfortableTargets: false,
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
