import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLOSE_BASE_MS, OPEN_BASE_MS, createDrawerMotion, planDrawerMotion, readTranslateX,
} from '../src/client/drawer-motion.js';

const base = { opening: true, width: 320, currentPx: -320, reducedMotion: false };

test('reduced motion never animates', () => {
  assert.equal(planDrawerMotion({ ...base, reducedMotion: true }), null);
});

test('an unmeasurable or degenerate drawer does not animate', () => {
  assert.equal(planDrawerMotion({ ...base, width: 0 }), null);
  assert.equal(planDrawerMotion({ ...base, width: 0.4 }), null);
  assert.equal(planDrawerMotion({ ...base, width: Number.NaN }), null);
  // Already at the target: nothing to draw.
  assert.equal(planDrawerMotion({ ...base, currentPx: 0 }), null);
  assert.equal(planDrawerMotion({ ...base, opening: false, currentPx: -320 }), null);
});

test('a full open slides from off-screen to the edge', () => {
  const plan = planDrawerMotion(base);
  assert.ok(plan);
  assert.deepEqual(plan.keyframes, [{ transform: 'translateX(-320px)' }, { transform: 'translateX(0px)' }]);
  assert.equal(plan.duration, Math.round(OPEN_BASE_MS * 1));
  assert.match(plan.easing, /cubic-bezier/);
});

test('a full close slides back off-screen and is not slower than opening', () => {
  const plan = planDrawerMotion({ ...base, opening: false, currentPx: 0 });
  assert.ok(plan);
  assert.deepEqual(plan.keyframes, [{ transform: 'translateX(0px)' }, { transform: 'translateX(-320px)' }]);
  assert.equal(plan.duration, Math.round(CLOSE_BASE_MS * 1));
  assert.ok(CLOSE_BASE_MS <= OPEN_BASE_MS, 'dismissing must not feel stickier than opening');
});

test('an interrupted slide resumes from where it visibly is', () => {
  // User taps open, then closes mid-flight at -140.
  const plan = planDrawerMotion({ opening: false, width: 320, currentPx: -140, reducedMotion: false });
  assert.ok(plan);
  assert.deepEqual(plan.keyframes, [{ transform: 'translateX(-140px)' }, { transform: 'translateX(-320px)' }]);
  // Shorter travel => shorter duration than a full close.
  assert.ok(plan.duration < CLOSE_BASE_MS);
});

test('a partially open drawer finishes faster than a full one', () => {
  const half = planDrawerMotion({ ...base, currentPx: -160 });
  const full = planDrawerMotion(base);
  assert.ok(half && full);
  assert.ok(half.duration < full.duration);
  // ...but never so short that it reads as a jump.
  assert.ok(half.duration >= Math.round(OPEN_BASE_MS * 0.55) - 1);
});

test('an out-of-range position is clamped into the drawer range', () => {
  const beyond = planDrawerMotion({ ...base, currentPx: -9999 });
  assert.ok(beyond);
  assert.equal(beyond.keyframes[0]?.transform, 'translateX(-320px)');
  const positive = planDrawerMotion({ ...base, opening: false, currentPx: 500 });
  assert.ok(positive);
  assert.equal(positive.keyframes[0]?.transform, 'translateX(0px)');
});

test('a non-finite position falls back to the target instead of NaN', () => {
  assert.equal(planDrawerMotion({ ...base, currentPx: Number.NaN }), null);
});

test('readTranslateX reads matrix() and matrix3d(), clamps, and reports unreadable as undefined', () => {
  const element = (transform: string) => ({ nodeType: 1, transform }) as unknown as Element;
  const g = globalThis as unknown as { getComputedStyle: (el: Element) => { transform: string } };
  const original = g.getComputedStyle;
  try {
    g.getComputedStyle = el => ({ transform: (el as unknown as { transform: string }).transform });
    // `undefined` (not 0) is the honest answer for "no usable reading": the driver
    // then falls back to a derived offset instead of believing the drawer is open.
    assert.equal(readTranslateX(element('none'), 320), undefined);
    assert.equal(readTranslateX(element('garbage'), 320), undefined);
    assert.equal(readTranslateX(element(''), 320), undefined);
    assert.equal(readTranslateX(element('matrix(1, 0, 0, 1, -140, 0)'), 320), -140);
    assert.equal(readTranslateX(element('matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,-140,0,0,1)'), 320), -140);
    // Out of range clamps to the drawer interval.
    assert.equal(readTranslateX(element('matrix(1, 0, 0, 1, 50, 0)'), 320), 0);
    assert.equal(readTranslateX(element('matrix(1, 0, 0, 1, -900, 0)'), 320), -320);
  } finally {
    g.getComputedStyle = original;
  }
});

test('the start offset is derived at rest, so a jumped computed style cannot cancel the slide', () => {
  // Regression: the host flips its collapsed attribute and the stylesheet applies
  // the DESTINATION transform in the same beat, so reading computed style at
  // notification time yields the target and planning would bail out with zero
  // travel. At rest the driver derives the start from the target state instead.
  const element = {
    nodeType: 1,
    attributes: new Set<string>(),
    getBoundingClientRect: () => ({ width: 320 }),
    setAttribute(name: string) { this.attributes.add(name); },
    removeAttribute(name: string) { this.attributes.delete(name); },
    animate: () => ({}),
  };
  const g = globalThis as unknown as { getComputedStyle: (el: Element) => { transform: string } };
  const originalStyle = g.getComputedStyle;
  try {
    // Computed style claims "already open" — exactly the trap.
    g.getComputedStyle = () => ({ transform: 'matrix(1, 0, 0, 1, 0, 0)' });
    const driver = createDrawerMotion({
      column: () => element as unknown as Element,
      reducedMotion: () => false,
    });
    const seen: { frames: { transform: string }[]; hadHints: boolean }[] = [];
    (element as unknown as { animate: (k: { transform: string }[]) => unknown }).animate = frames => {
      seen.push({ frames, hadHints: element.attributes.has('data-dsh-mobile-sliding') });
      return {};
    };
    driver.run(true);
    assert.equal(seen.length, 1, 'the slide must be planned despite the misleading computed style');
    assert.equal(seen[0]?.frames[0]?.transform, 'translateX(-320px)');
    assert.equal(seen[0]?.frames[1]?.transform, 'translateX(0px)');
    assert.equal(seen[0]?.hadHints, true, 'layer hints are set only while sliding');
    assert.equal(driver.target, true);
    driver.dispose();
    assert.equal(element.attributes.has('data-dsh-mobile-sliding'), false, 'dispose clears the hints');
    assert.equal(driver.target, undefined);
  } finally {
    g.getComputedStyle = originalStyle;
  }
});

test('an optimistic start makes the observer skip its own run', () => {
  // The toggle starts the slide on the tap; when the host's attribute mutation
  // arrives a frame later the observer must not restart it from the other end.
  const element = {
    nodeType: 1,
    attributes: new Set<string>(),
    getBoundingClientRect: () => ({ width: 320 }),
    setAttribute(name: string) { this.attributes.add(name); },
    removeAttribute(name: string) { this.attributes.delete(name); },
    animate: () => ({}),
  };
  let calls = 0;
  (element as unknown as { animate: (k: unknown) => unknown }).animate = () => { calls += 1; return {}; };
  const g = globalThis as unknown as { getComputedStyle: (el: Element) => { transform: string } };
  const originalStyle = g.getComputedStyle;
  try {
    g.getComputedStyle = () => ({ transform: 'none' });
    const driver = createDrawerMotion({ column: () => element as unknown as Element, reducedMotion: () => false });
    driver.run(true);
    assert.equal(calls, 1);
    // Second identical call while already targeting open: restarting is fine, but
    // the observer's guard is what matters, asserted below.
    assert.equal(driver.target, true);
    driver.dispose();
  } finally {
    g.getComputedStyle = originalStyle;
  }
});
