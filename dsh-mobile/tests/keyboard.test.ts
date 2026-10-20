import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeKeyboardInset, MAX_INSET_RATIO, NOISE_FLOOR } from '../src/client/install-keyboard.js';

test('no visual viewport means no inset', () => {
  assert.equal(computeKeyboardInset({ layoutHeight: 844, visualHeight: undefined, visualOffsetTop: 0 }), 0);
  assert.equal(computeKeyboardInset({ layoutHeight: 0, visualHeight: 0, visualOffsetTop: 0 }), 0);
  assert.equal(computeKeyboardInset({ layoutHeight: 844, visualHeight: Number.NaN, visualOffsetTop: 0 }), 0);
});

test('browser chrome noise never reserves space', () => {
  assert.equal(computeKeyboardInset({ layoutHeight: 844, visualHeight: 844, visualOffsetTop: 0 }), 0);
  assert.equal(computeKeyboardInset({ layoutHeight: 844, visualHeight: 844 - NOISE_FLOOR, visualOffsetTop: 0 }), 0);
  // One pixel past the floor is reported as-is: it is measurement, not noise.
  assert.equal(computeKeyboardInset({ layoutHeight: 844, visualHeight: 844 - NOISE_FLOOR - 1, visualOffsetTop: 0 }), NOISE_FLOOR + 1);
});

test('a real keyboard shrinks the visual viewport and yields that band', () => {
  // 844 - 500 - 0 = 344, but the 40% cap applies: floor(844 * 0.4) = 337.
  assert.equal(computeKeyboardInset({ layoutHeight: 844, visualHeight: 500, visualOffsetTop: 0 }), Math.floor(844 * MAX_INSET_RATIO));
  // Small keyboard stays under the cap and is reported exactly.
  assert.equal(computeKeyboardInset({ layoutHeight: 844, visualHeight: 600, visualOffsetTop: 0 }), 244);
});

test('a scrolled visual viewport subtracts its offset instead of double counting', () => {
  assert.equal(computeKeyboardInset({ layoutHeight: 844, visualHeight: 600, visualOffsetTop: 40 }), 204);
  assert.equal(computeKeyboardInset({ layoutHeight: 844, visualHeight: 600, visualOffsetTop: Number.NaN }), 244);
});

test('the result is a whole non-negative pixel count', () => {
  const value = computeKeyboardInset({ layoutHeight: 844.6, visualHeight: 500.2, visualOffsetTop: 0.3 });
  assert.ok(Number.isInteger(value));
  assert.ok(value >= 0);
  assert.equal(computeKeyboardInset({ layoutHeight: 844, visualHeight: 900, visualOffsetTop: 0 }), 0);
});
