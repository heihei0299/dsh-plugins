import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_ANCHOR, CHAT_FLOW, CONVERSATION_SCROLL } from '../src/client/landmarks.js';
import { PULL_LOAD_PX, OWNS_TOUCH, installHistoryAutoload, pullTravel } from '../src/client/install-history-autoload.js';
import type { ClientContext, SessionHistoryState } from '../src/client/contracts.js';

/* ------------------------------------------------------------------------- *
 * A hand-written touch surface: only what install-history-autoload.ts reads.
 * `closest` answers from a map so one fake target can belong to both the
 * scrollport and a control that owns its own gesture.
 * ------------------------------------------------------------------------- */

interface Point { readonly clientY: number; readonly identifier: number }

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly closestResults = new Map<string, FakeElement | null>();
  readonly queryResults = new Map<string, FakeElement[]>();
  isConnected = true;
  scrollTop = 0;
  scrollHeight = 0;
  top = 0;
  height = 0;

  constructor(readonly tagName = 'div') {}

  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }

  closest(selector: string): FakeElement | null {
    if (this.closestResults.has(selector)) return this.closestResults.get(selector) ?? null;
    return null;
  }

  querySelector(selector: string): FakeElement | null {
    return this.queryResults.get(selector)?.[0] ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.queryResults.get(selector) ?? [];
  }

  getBoundingClientRect(): DOMRect {
    return {
      top: this.top, bottom: this.top + this.height, height: this.height,
      left: 0, right: 0, width: 0, x: 0, y: this.top, toJSON: () => ({}),
    } as DOMRect;
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

interface WorldOptions {
  readonly hasMore?: boolean;
  readonly loadingOlder?: boolean;
  readonly openState?: SessionHistoryState['openState'];
}

function createWorld(options: WorldOptions = {}) {
  const scroller = new FakeElement();
  const flow = new FakeElement();
  const target = new FakeElement();
  target.closestResults.set(CONVERSATION_SCROLL, scroller);
  scroller.queryResults.set(CHAT_FLOW, [flow]);

  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const document = {
    addEventListener(type: string, listener: (event: unknown) => void) {
      const set = listeners.get(type) ?? new Set<(event: unknown) => void>();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type: string, listener: (event: unknown) => void) { listeners.get(type)?.delete(listener); },
    fire(type: string, event: unknown) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
    },
    listenerCount(type: string): number { return listeners.get(type)?.size ?? 0; },
  };

  const state: { hasMore: boolean; loadingOlder: boolean; openState: SessionHistoryState['openState'] } = {
    hasMore: options.hasMore ?? true,
    loadingOlder: options.loadingOlder ?? false,
    openState: options.openState ?? 'open',
  };
  let loads = 0;
  let onLoad: (() => void) | null = null;

  const session = {
    getSnapshot: () => ({
      openState: state.openState,
      hasMore: state.hasMore,
      loadingOlder: state.loadingOlder,
    }),
    loadOlder: async () => {
      loads += 1;
      state.loadingOlder = true;
      await Promise.resolve();
      scroller.scrollHeight += 2000;
      state.loadingOlder = false;
      onLoad?.();
    },
  };

  const ctx = {
    sessions: {
      list: { getSnapshot: () => ({ byId: { session: { retainedBy: { mainView: 1 } } } }), subscribe: () => () => {} },
      binding: (id: string) => (id === 'session' ? { session } : undefined),
    },
  } as unknown as ClientContext;

  return {
    scroller, flow, target, document, ctx, state,
    get loads() { return loads; },
    onLoad(listener: () => void) { onLoad = listener; },
  };
}

interface FakeTouchEvent {
  touches: Point[];
  changedTouches: Point[];
  target: FakeElement;
}

function start(y: number, target: FakeElement): FakeTouchEvent {
  return { touches: [{ clientY: y, identifier: 1 }], changedTouches: [{ clientY: y, identifier: 1 }], target };
}

function move(y: number, target: FakeElement): FakeTouchEvent {
  return { touches: [{ clientY: y, identifier: 1 }], changedTouches: [{ clientY: y, identifier: 1 }], target };
}

function end(target: FakeElement): FakeTouchEvent {
  return { touches: [], changedTouches: [{ clientY: 0, identifier: 1 }], target };
}

/** Wait past the plugin's one macrotask and the session promise. */
async function settle(): Promise<void> {
  await new Promise(resolve => { setTimeout(resolve, 20); });
}

function browser(world: ReturnType<typeof createWorld>): () => void {
  return installGlobals({
    document: world.document,
    Element: FakeElement,
    HTMLElement: FakeElement,
  });
}

test('downward travel accumulates and upward movement cannot trigger a page', () => {
  assert.equal(pullTravel(0, 10), 10);
  assert.equal(pullTravel(10, 10), 20);
  assert.equal(pullTravel(20, -5), 15);
  assert.equal(pullTravel(5, -50), 0);
  assert.equal(pullTravel(7, Number.NaN), 7);
});

test('a pull past the threshold at the head loads one page and keeps the reading place', async (t) => {
  const world = createWorld();
  const restore = browser(world);
  world.scroller.scrollTop = 0;
  world.scroller.scrollHeight = 1000;
  const dispose = installHistoryAutoload(world.ctx);
  t.after(() => { dispose(); restore(); });

  world.document.fire('touchstart', start(300, world.target));
  world.document.fire('touchmove', move(300 + PULL_LOAD_PX - 8, world.target));
  assert.equal(world.loads, 0, 'a shorter pull must not page');
  world.document.fire('touchmove', move(300 + PULL_LOAD_PX + 4, world.target));
  // One gesture asks for one page even while the finger keeps travelling.
  world.document.fire('touchmove', move(300 + PULL_LOAD_PX + 80, world.target));
  await settle();

  assert.equal(world.loads, 1);
  assert.equal(world.scroller.scrollTop, 2000, 'the prepended height is added to scrollTop');
});

test('the pull only counts after the finger reaches the head', async (t) => {
  const world = createWorld();
  const restore = browser(world);
  world.scroller.scrollTop = 120;
  world.scroller.scrollHeight = 4000;
  const dispose = installHistoryAutoload(world.ctx);
  t.after(() => { dispose(); restore(); });

  world.document.fire('touchstart', start(300, world.target));
  world.document.fire('touchmove', move(360, world.target));
  assert.equal(world.loads, 0, 'travel below the head is an ordinary scroll');
  world.scroller.scrollTop = 0;
  world.document.fire('touchmove', move(360 + PULL_LOAD_PX + 8, world.target));
  await settle();
  assert.equal(world.loads, 1);
});

test('history is not paged again while a page is loading, exhausted, or not open', async (t) => {
  const world = createWorld({ loadingOlder: true });
  const restore = browser(world);
  const dispose = installHistoryAutoload(world.ctx);
  t.after(() => { dispose(); restore(); });

  async function pull(): Promise<void> {
    world.document.fire('touchstart', start(300, world.target));
    world.document.fire('touchmove', move(400, world.target));
    world.document.fire('touchend', end(world.target));
    await settle();
  }

  await pull();
  assert.equal(world.loads, 0, 'already paging');

  world.state.loadingOlder = false;
  world.state.hasMore = false;
  await pull();
  assert.equal(world.loads, 0, 'no older history');

  world.state.hasMore = true;
  world.state.openState = 'loading';
  await pull();
  assert.equal(world.loads, 0, 'window not open yet');
});

test('an anchor row keeps its measured offset across the prepend', async (t) => {
  const world = createWorld();
  const restore = browser(world);
  const row = new FakeElement();
  row.setAttribute('data-chat-anchor-key', 'turn-3');
  row.top = 16;
  row.height = 40;
  world.scroller.queryResults.set(CHAT_ANCHOR, [row]);
  world.scroller.scrollTop = 0;
  world.scroller.scrollHeight = 1000;
  world.onLoad(() => { row.top = 2048; });
  const dispose = installHistoryAutoload(world.ctx);
  t.after(() => { dispose(); restore(); });

  world.document.fire('touchstart', start(300, world.target));
  world.document.fire('touchmove', move(380, world.target));
  await settle();
  assert.equal(world.loads, 1);
  assert.equal(world.scroller.scrollTop, 2032, 'the scrollport follows the row, not the raw height delta');
});

test('a reader who moved during the request keeps their new position', async (t) => {
  const world = createWorld();
  const restore = browser(world);
  world.scroller.scrollTop = 0;
  world.scroller.scrollHeight = 1000;
  world.onLoad(() => { world.scroller.scrollTop = 120; });
  const dispose = installHistoryAutoload(world.ctx);
  t.after(() => { dispose(); restore(); });

  world.document.fire('touchstart', start(300, world.target));
  world.document.fire('touchmove', move(380, world.target));
  await settle();
  assert.equal(world.loads, 1);
  assert.equal(world.scroller.scrollTop, 120);
});

test('gestures that belong to a control, a pinch, or another view are ignored', async (t) => {
  const world = createWorld();
  const restore = browser(world);
  const dispose = installHistoryAutoload(world.ctx);
  t.after(() => { dispose(); restore(); });

  // Starting on the composer or an editable field.
  const owned = new FakeElement();
  owned.closestResults.set(CONVERSATION_SCROLL, world.scroller);
  owned.closestResults.set(OWNS_TOUCH, owned);
  world.document.fire('touchstart', start(300, owned));
  world.document.fire('touchmove', move(400, owned));

  // A pinch: two fingers down.
  world.document.fire('touchstart', { touches: [{ clientY: 300, identifier: 1 }, { clientY: 300, identifier: 2 }], changedTouches: [], target: world.target });
  world.document.fire('touchmove', move(400, world.target));

  // A scrollport that is showing the trajectory view instead of the Chat flow.
  world.scroller.queryResults.delete(CHAT_FLOW);
  world.document.fire('touchstart', start(300, world.target));
  world.document.fire('touchmove', move(400, world.target));

  // A cancelled gesture must not page on the next lift either.
  world.scroller.queryResults.set(CHAT_FLOW, [world.flow]);
  world.document.fire('touchstart', start(300, world.target));
  world.document.fire('touchcancel', {});
  world.document.fire('touchend', end(world.target));

  await settle();
  assert.equal(world.loads, 0);
});

test('disposing removes every listener', () => {
  const world = createWorld();
  const restore = browser(world);
  const dispose = installHistoryAutoload(world.ctx);
  assert.equal(world.document.listenerCount('touchstart'), 1);
  dispose();
  restore();
  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
    assert.equal(world.document.listenerCount(type), 0, `${type} listener leaked`);
  }
});
