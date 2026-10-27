import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLLAPSED_ATTRIBUTE, FRAME, SIDEBAR_COLUMN } from '../src/client/landmarks.js';
import { OVERLAYS } from '../src/client/install-drawer.js';
import {
  SWIPE_MIN_PX, SWIPE_SLOPE, insideHorizontalScroller, installSwipeNavigation, swipeAction,
} from '../src/client/install-gestures.js';
import type { ClientContext } from '../src/client/contracts.js';

/* ------------------------------------------------------------------------- *
 * A hand-written touch surface: only what install-gestures.ts reads. The
 * selector engine is not emulated; `closest` answers the one question the
 * installer asks (does this touch start on a control that owns it?).
 * ------------------------------------------------------------------------- */

class FakeElement {
  readonly attributes = new Map<string, string>();
  parentElement: FakeElement | null = null;
  overflowX = 'visible';
  scrollWidth = 0;
  clientWidth = 0;
  /** What `closest` answers; null means "not on an owning control". */
  owner: FakeElement | null = null;

  constructor(readonly tagName = 'div') {}

  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  hasAttribute(name: string): boolean { return this.attributes.has(name); }
  closest(_selector: string): FakeElement | null { return this.owner; }
  contains(node: FakeElement | null): boolean {
    let current: FakeElement | null = node;
    while (current !== null) {
      if (current === this) return true;
      current = current.parentElement;
    }
    return false;
  }

  /** A painted box is what `overlayOnScreen` counts, so `class="open"` paints. */
  getClientRects(): object[] {
    const classes = (this.getAttribute('class') ?? '').split(/\s+/);
    return classes.includes('open') ? [{}] : [];
  }
}

function installGlobals(values: Record<string, unknown>): () => void {
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries(values)) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  return () => {
    for (const [name, descriptor] of saved) {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
      else Object.defineProperty(globalThis, name, descriptor);
    }
  };
}

interface TouchPoint { readonly clientX: number; readonly clientY: number; readonly identifier: number }

interface FakeTouchEvent {
  touches: TouchPoint[];
  changedTouches: TouchPoint[];
  target: FakeElement;
}

function createWorld(options: { collapsed: boolean; body?: FakeElement; overlays?: FakeElement[]; sidebar?: FakeElement }) {
  const body = options.body ?? new FakeElement('body');
  const frame = new FakeElement('div');
  const sidebar = options.sidebar ?? new FakeElement('div');
  if (options.collapsed) frame.setAttribute(COLLAPSED_ATTRIBUTE, '');
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const document = {
    body,
    get activeElement() { return null; },
    querySelector(selector: string) {
      if (selector === FRAME) return frame;
      if (selector === SIDEBAR_COLUMN) return sidebar;
      return null;
    },
    querySelectorAll(selector: string) { return selector === OVERLAYS ? options.overlays ?? [] : []; },
    addEventListener(type: string, listener: (event: unknown) => void) {
      const set = listeners.get(type) ?? new Set<(event: unknown) => void>();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type: string, listener: (event: unknown) => void) { listeners.get(type)?.delete(listener); },
    fire(type: string, event: unknown) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
    },
    listenerCount(type: string) { return listeners.get(type)?.size ?? 0; },
  };
  let toggles = 0;
  const ctx = { layout: { toggleSidebar() { toggles += 1; } } } as unknown as ClientContext;
  return { body, frame, sidebar, document, ctx, get toggles() { return toggles; } };
}

/** One finger down and up, in the shape a browser delivers them. */
function gesture(start: { x: number; y: number }, end: { x: number; y: number }, target: FakeElement): { down: FakeTouchEvent; up: FakeTouchEvent } {
  const point = (clientX: number, clientY: number): TouchPoint => ({ clientX, clientY, identifier: 1 });
  return {
    down: { touches: [point(start.x, start.y)], changedTouches: [point(start.x, start.y)], target },
    up: { touches: [], changedTouches: [point(end.x, end.y)], target },
  };
}

test('only a decisive horizontal gesture asks the drawer to move', () => {
  assert.equal(swipeAction({ dx: 100, dy: 10, collapsed: true }), 'open');
  assert.equal(swipeAction({ dx: -100, dy: 10, collapsed: false }), 'close');
  // Asking for the state the drawer is already in is not a command.
  assert.equal(swipeAction({ dx: 100, dy: 10, collapsed: false }), 'ignore');
  assert.equal(swipeAction({ dx: -100, dy: 10, collapsed: true }), 'ignore');
  // Too short, too diagonal, or not a number.
  assert.equal(swipeAction({ dx: SWIPE_MIN_PX - 1, dy: 0, collapsed: true }), 'ignore');
  assert.equal(swipeAction({ dx: SWIPE_MIN_PX, dy: SWIPE_MIN_PX / SWIPE_SLOPE + 1, collapsed: true }), 'ignore');
  assert.equal(swipeAction({ dx: Number.NaN, dy: 0, collapsed: true }), 'ignore');
  assert.equal(swipeAction({ dx: 100, dy: Number.POSITIVE_INFINITY, collapsed: true }), 'ignore');
});

test('a right swipe opens a closed drawer through the public layout face', (t) => {
  const world = createWorld({ collapsed: true });
  t.after(installGlobals({
    document: world.document,
    Element: FakeElement,
    getComputedStyle: () => ({ overflowX: 'visible' }),
  }));
  const dispose = installSwipeNavigation(world.ctx);
  const { down, up } = gesture({ x: 20, y: 300 }, { x: 180, y: 296 }, new FakeElement('div'));
  world.document.fire('touchstart', down);
  world.document.fire('touchend', up);
  assert.equal(world.toggles, 1);
  dispose();
});

test('a left swipe closes an open drawer', (t) => {
  const world = createWorld({ collapsed: false });
  t.after(installGlobals({
    document: world.document,
    Element: FakeElement,
    getComputedStyle: () => ({ overflowX: 'visible' }),
  }));
  const dispose = installSwipeNavigation(world.ctx);
  const { down, up } = gesture({ x: 200, y: 400 }, { x: 60, y: 402 }, new FakeElement('div'));
  world.document.fire('touchstart', down);
  world.document.fire('touchend', up);
  assert.equal(world.toggles, 1);
  dispose();
});

test('vertical drags, multi-finger touches and owned controls never navigate', (t) => {
  const world = createWorld({ collapsed: true });
  t.after(installGlobals({
    document: world.document,
    Element: FakeElement,
    getComputedStyle: () => ({ overflowX: 'visible' }),
  }));
  const dispose = installSwipeNavigation(world.ctx);

  // A list scroll: 80px right, 300px down.
  let pair = gesture({ x: 20, y: 300 }, { x: 100, y: 600 }, new FakeElement('div'));
  world.document.fire('touchstart', pair.down);
  world.document.fire('touchend', pair.up);

  // A pinch: two fingers down, one of them travelling 160px.
  pair = gesture({ x: 40, y: 300 }, { x: 200, y: 300 }, new FakeElement('div'));
  world.document.fire('touchstart', { ...pair.down, touches: [...pair.down.touches, ...pair.down.touches] });
  world.document.fire('touchend', pair.up);

  // A gesture that starts on the composer / drawer toggle / scrim.
  const owned = new FakeElement('div');
  owned.owner = new FakeElement('div');
  pair = gesture({ x: 20, y: 300 }, { x: 180, y: 300 }, owned);
  world.document.fire('touchstart', pair.down);
  world.document.fire('touchend', pair.up);

  // A cancelled gesture must not fire on the next finger lift.
  pair = gesture({ x: 20, y: 300 }, { x: 180, y: 300 }, new FakeElement('div'));
  world.document.fire('touchstart', pair.down);
  world.document.fire('touchcancel', {});
  world.document.fire('touchend', pair.up);

  assert.equal(world.toggles, 0);
  dispose();
});

test('the open drawer is itself a host popover and must not block its own close gesture', (t) => {
  // Measured in the live host: the narrow layout renders the sidebar column with
  // a `popover` attribute, so a naive overlay guard would refuse every gesture
  // while the drawer is open — including the left swipe that closes it.
  const sidebar = new FakeElement('div');
  sidebar.setAttribute('popover', 'manual');
  sidebar.setAttribute('class', 'open');
  const row = new FakeElement('div');
  row.parentElement = sidebar;
  const world = createWorld({ collapsed: false, sidebar, overlays: [sidebar] });
  t.after(installGlobals({
    document: world.document,
    Element: FakeElement,
    getComputedStyle: () => ({ overflowX: 'visible' }),
  }));
  const dispose = installSwipeNavigation(world.ctx);
  const { down, up } = gesture({ x: 280, y: 400 }, { x: 40, y: 400 }, row);
  world.document.fire('touchstart', down);
  world.document.fire('touchend', up);
  assert.equal(world.toggles, 1, 'a left swipe on the open drawer still closes it');
  dispose();
});

test('a painted host dialog keeps the gesture to itself', (t) => {
  const dialog = new FakeElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('class', 'open');
  const closedPopover = new FakeElement('div');
  closedPopover.setAttribute('popover', 'manual');
  const world = createWorld({ collapsed: true, overlays: [closedPopover, dialog] });
  t.after(installGlobals({
    document: world.document,
    Element: FakeElement,
    getComputedStyle: () => ({ overflowX: 'visible' }),
  }));
  const dispose = installSwipeNavigation(world.ctx);
  const { down, up } = gesture({ x: 20, y: 300 }, { x: 200, y: 300 }, new FakeElement('div'));
  world.document.fire('touchstart', down);
  world.document.fire('touchend', up);
  assert.equal(world.toggles, 0, 'an unpainted popover is not an overlay; a painted dialog is');
  dispose();
});

test('a gesture inside a horizontal scroller belongs to that scroller', (t) => {
  const body = new FakeElement('body');
  const scroller = new FakeElement('div');
  scroller.overflowX = 'auto';
  scroller.scrollWidth = 900;
  scroller.clientWidth = 300;
  const target = new FakeElement('span');
  target.parentElement = scroller;
  scroller.parentElement = body;
  const world = createWorld({ collapsed: true, body });
  t.after(installGlobals({
    document: world.document,
    Element: FakeElement,
    getComputedStyle: (element: unknown) => ({ overflowX: (element as FakeElement).overflowX }),
  }));
  const dispose = installSwipeNavigation(world.ctx);
  const { down, up } = gesture({ x: 20, y: 300 }, { x: 200, y: 300 }, target);
  world.document.fire('touchstart', down);
  world.document.fire('touchend', up);
  assert.equal(world.toggles, 0);
  dispose();
});

test('a scroller with nothing to scroll does not swallow the gesture', (t) => {
  const body = new FakeElement('body');
  const scroller = new FakeElement('div');
  scroller.overflowX = 'auto';
  scroller.scrollWidth = 300;
  scroller.clientWidth = 300;
  const target = new FakeElement('span');
  target.parentElement = scroller;
  scroller.parentElement = body;
  t.after(installGlobals({
    document: { body },
    getComputedStyle: (element: unknown) => ({ overflowX: (element as FakeElement).overflowX }),
  }));
  assert.equal(insideHorizontalScroller(target as unknown as Element), false);
});

test('disposal removes every listener', (t) => {
  const world = createWorld({ collapsed: true });
  t.after(installGlobals({
    document: world.document, Element: FakeElement, getComputedStyle: () => ({ overflowX: 'visible' }),
  }));
  const dispose = installSwipeNavigation(world.ctx);
  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
    assert.equal(world.document.listenerCount(type), 1, `${type} installed`);
  }
  dispose();
  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
    assert.equal(world.document.listenerCount(type), 0, `${type} removed`);
  }
});
