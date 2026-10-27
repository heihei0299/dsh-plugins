import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOST_LANDMARKS } from '../src/client/landmarks.js';
import { PROBE_ANCHORS, PROBE_LANDMARKS } from '../scripts/probe-landmarks.mjs';

/**
 * The artifact check (`verify-bundle`) and the live probe are separate: the
 * former can only see the plugin's own bundle, the latter is the host check.
 * The selector strings are duplicated because the probe must run under bare
 * node, so this static test is what keeps the two copies identical.
 */
test('every stylesheet landmark keeps the exact same selector in the live probe', () => {
  const probe = new Map(PROBE_LANDMARKS.map(entry => [entry.name, entry.selector]));
  for (const landmark of HOST_LANDMARKS) {
    assert.equal(
      probe.get(landmark.name),
      landmark.selector,
      `probe selector for "${landmark.name}" drifted from src/client/landmarks.ts`,
    );
  }
});

test('the live probe never keys a required landmark off localized copy', () => {
  for (const entry of PROBE_LANDMARKS) {
    assert.match(entry.key, /^[a-z0-9-]+$/);
    assert.ok(
      entry.when === 'always' || entry.when === null || Object.hasOwn(PROBE_ANCHORS, entry.when),
      `unknown page-state condition "${entry.when}" for ${entry.name}`,
    );
    assert.doesNotMatch(entry.selector, /aria-label/, `${entry.name} must not depend on a localized label`);
  }
});
