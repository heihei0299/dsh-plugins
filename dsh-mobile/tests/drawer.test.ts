import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DRAWER_ID, installDrawerInteraction, installDrawerTarget } from '../src/client/install-drawer.js';
import type { ClientContext } from '../src/client/contracts.js';
import { CENTER_COLUMN, FRAME, SIDEBAR_COLUMN } from '../src/client/landmarks.js';

/* ------------------------------------------------------------------------- *
 * A hand-written DOM surface: only the APIs install-drawer.ts actually uses.
 * Selectors are matched for the small subset this plugin queries (tags,
 * attributes, `.class` and `:disabled`); structural queries are routed by the
 * exported landmark constants instead of pretending to be a CSS engine.
 * ------------------------------------------------------------------------- */

let activeElement: FakeElement | null = null;

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly style = { visibility: 'visible' };
  parent: FakeElement | null = null;
  tabIndex = -1;
  disabled = false;
  rectCount = 1;

  constructor(readonly tagName: string) {
    if (['a', 'button', 'input', 'select', 'textarea', 'summary'].includes(tagName)) this.tabIndex = 0;
  }

  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string): void { this.attributes.delete(name); }
  hasAttribute(name: string): boolean { return this.attributes.has(name); }

  append(...elements: FakeElement[]): void {
    for (const element of elements) {
      element.parent = this;
      this.children.push(element);
    }
  }

  remove(): void {
    if (this.parent === null) return;
    const index = this.parent.children.indexOf(this);
    if (index >= 0) this.parent.children.splice(index, 1);
    this.parent = null;
  }

  get isConnected(): boolean {
    let current: FakeElement | null = this;
    while (current !== null) {
      if (current.tagName === 'body') return true;
      current = current.parent;
    }
    return false;
  }

  contains(node: unknown): boolean {
    let current = node instanceof FakeElement ? node : null;
    while (current !== null) {
      if (current === this) return true;
      current = current.parent;
    }
    return false;
  }

  closest(selector: string): FakeElement | null {
    let current: FakeElement | null = this;
    while (current !== null) {
      if (matchesSelector(current, selector)) return current;
      current = current.parent;
    }
    return null;
  }

  matches(selector: string): boolean { return matchesSelector(this, selector); }

  querySelectorAll(selector: string): FakeElement[] {
    return this.descendants().filter(element => matchesSelector(element, selector));
  }

  getClientRects(): object[] { return this.rectCount > 0 ? [{}] : []; }

  focus(_options?: { preventScroll?: boolean }): void { activeElement = this; }

  descendants(): FakeElement[] {
    return this.children.flatMap(child => [child, ...child.descendants()]);
  }
}

function matchesSelector(element: FakeElement, selector: string): boolean {
  return selector.split(',').some(part => matchesSimple(element, part.trim()));
}

function matchesSimple(element: FakeElement, selector: string): boolean {
  if (selector === '') return false;
  if (selector === ':disabled') return element.disabled;
  if (selector.startsWith('.')) {
    return (element.getAttribute('class') ?? '').split(/\s+/).includes(selector.slice(1));
  }
  let rest = selector;
  const tag = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(rest)?.[0];
  if (tag !== undefined) {
    if (element.tagName !== tag.toLowerCase()) return false;
    rest = rest.slice(tag.length);
  }
  const attributes = [...rest.matchAll(/\[([^\]=]+)(?:="([^"]*)")?\]/g)];
  if (attributes.length === 0) return rest === '';
  return attributes.every(match => {
    const value = element.getAttribute(match[1] ?? '');
    return value !== null && (match[2] === undefined || value === match[2]);
  });
}

interface FakeDocument {
  readonly activeElement: FakeElement | null;
  querySelector(selector: string): FakeElement | null;
  querySelectorAll(selector: string): FakeElement[];
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
  fire(type: string, event: unknown): void;
  listenerCount(type: string): number;
}

interface FakeDom {
  document: FakeDocument;
  body: FakeElement;
  frame: FakeElement;
  drawer: FakeElement;
  center: FakeElement;
  rightbar: FakeElement;
  bottom: FakeElement;
  toggle: FakeElement;
  first: FakeElement;
  middle: FakeElement;
  last: FakeElement;
  disabled: FakeElement;
  hidden: FakeElement;
  outside: FakeElement;
  getComputedStyle(element: FakeElement): { visibility: string };
  create(tagName?: string): FakeElement;
  mount(...elements: FakeElement[]): void;
}

function createFakeDom(options: { sidebar?: boolean } = {}): FakeDom {
  activeElement = null;
  const body = new FakeElement('body');
  const frame = new FakeElement('div');
  const drawer = new FakeElement('aside');
  const center = new FakeElement('div');
  const rightbar = new FakeElement('div');
  const bottom = new FakeElement('div');
  bottom.setAttribute('data-shell-bottom', '');
  const header = new FakeElement('header');
  const toggle = new FakeElement('button');
  toggle.setAttribute('class', 'dsh-mobile-toggle');
  const first = new FakeElement('button');
  const middle = new FakeElement('button');
  const last = new FakeElement('a');
  last.setAttribute('href', '#last');
  const disabled = new FakeElement('button');
  disabled.disabled = true;
  const hidden = new FakeElement('button');
  hidden.setAttribute('hidden', '');
  const outside = new FakeElement('button');
  header.append(toggle, outside);
  drawer.append(first, middle, last, disabled, hidden);
  frame.append(drawer, center, rightbar, bottom, header);
  body.append(frame);

  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const document: FakeDocument = {
    get activeElement() { return activeElement; },
    querySelector(selector) {
      if (selector === SIDEBAR_COLUMN) return options.sidebar === false ? null : drawer;
      if (selector === FRAME) return frame;
      if (selector === CENTER_COLUMN) return center;
      return body.descendants().find(element => matchesSelector(element, selector)) ?? null;
    },
    querySelectorAll(selector) {
      if (selector.includes('data-shell-bottom')) return [center, rightbar, bottom];
      return body.descendants().filter(element => matchesSelector(element, selector));
    },
    addEventListener(type, listener) {
      const set = listeners.get(type) ?? new Set<(event: unknown) => void>();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    fire(type, event) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
    },
    listenerCount(type) { return listeners.get(type)?.size ?? 0; },
  };

  return {
    document,
    body,
    frame,
    drawer,
    center,
    rightbar,
    bottom,
    toggle,
    first,
    middle,
    last,
    disabled,
    hidden,
    outside,
    getComputedStyle: element => ({ visibility: element.style.visibility }),
    create: (tagName = 'div') => new FakeElement(tagName),
    mount: (...elements) => { body.append(...elements); },
  };
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

type RetainedRow = { readonly retainedBy: { readonly mainView?: number } };
type SessionSnapshot = { readonly byId: Readonly<Record<string, RetainedRow>> };
type PanelSnapshot = { readonly activePanelId: string | null };

function createHostSource<T>(initial: T) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: (): T => snapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    set(next: T): void {
      snapshot = next;
      for (const listener of [...listeners]) listener();
    },
    get listenerCount(): number { return listeners.size; },
  };
}

function createWorld(options: {
  sidebar?: boolean;
  sessions?: Record<string, RetainedRow>;
  panel?: string | null;
} = {}) {
  const dom = createFakeDom(options);
  const sessions = createHostSource<SessionSnapshot>({
    byId: options.sessions ?? { 'session-a': { retainedBy: { mainView: 1 } } },
  });
  const panelInfo = createHostSource<PanelSnapshot>({ activePanelId: options.panel ?? null });
  let toggles = 0;
  const ctx = {
    sessions: { list: sessions },
    layout: { panelInfo, toggleSidebar: () => { toggles += 1; } },
  } as unknown as ClientContext;
  const restore = installGlobals({
    document: dom.document,
    HTMLElement: FakeElement,
    getComputedStyle: dom.getComputedStyle,
  });
  return { dom, ctx, sessions, panelInfo, toggles: () => toggles, restore };
}

interface FakeKeyEvent {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
  readonly defaultPrevented: boolean;
  preventDefault(): void;
  stopPropagation(): void;
  readonly propagationStopped: boolean;
}

function keydown(
  key: string,
  init: Partial<Pick<FakeKeyEvent, 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey' | 'isComposing'>> = {},
): FakeKeyEvent {
  let prevented = false;
  let stopped = false;
  return {
    key,
    shiftKey: init.shiftKey ?? false,
    altKey: init.altKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    isComposing: init.isComposing ?? false,
    get defaultPrevented() { return prevented; },
    preventDefault() { prevented = true; },
    stopPropagation() { stopped = true; },
    get propagationStopped() { return stopped; },
  };
}

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>(resolve => { queueMicrotask(() => { resolve(); }); });
}

test('installDrawerTarget aliases the sidebar id and restores the host value', (t) => {
  const world = createWorld();
  t.after(world.restore);
  const { drawer } = world.dom;

  drawer.setAttribute('id', 'host-sidebar');
  const first = installDrawerTarget();
  assert.equal(drawer.getAttribute('id'), DRAWER_ID);
  first();
  assert.equal(drawer.getAttribute('id'), 'host-sidebar');

  drawer.removeAttribute('id');
  const second = installDrawerTarget();
  assert.equal(drawer.getAttribute('id'), DRAWER_ID);
  second();
  assert.equal(drawer.getAttribute('id'), null, 'an absent id stays absent');

  const third = installDrawerTarget();
  drawer.setAttribute('id', 'host-renamed');
  third();
  assert.equal(drawer.getAttribute('id'), 'host-renamed', 'a host write during activation is not clobbered');
});

test('installDrawerTarget is a no-op without the host sidebar', (t) => {
  const world = createWorld({ sidebar: false });
  t.after(world.restore);
  const dispose = installDrawerTarget();
  assert.equal(typeof dispose, 'function');
  assert.equal(world.dom.drawer.getAttribute('id'), null, 'the missing landmark is not fabricated');
  dispose();
});

test('the drawer is modal only while installed and inert is restored per element', (t) => {
  const world = createWorld();
  t.after(world.restore);
  const { drawer, center, rightbar, bottom } = world.dom;
  drawer.setAttribute('role', 'navigation');
  drawer.setAttribute('aria-label', 'Host sidebar');
  drawer.setAttribute('tabindex', '0');
  rightbar.setAttribute('inert', '');

  const dispose = installDrawerInteraction(world.ctx, 'Navigation drawer');
  assert.equal(drawer.getAttribute('role'), 'dialog');
  assert.equal(drawer.getAttribute('aria-modal'), 'true');
  assert.equal(drawer.getAttribute('aria-label'), 'Navigation drawer');
  assert.equal(drawer.getAttribute('tabindex'), '-1');
  for (const element of [center, rightbar, bottom]) assert.equal(element.hasAttribute('inert'), true);

  drawer.setAttribute('role', 'presentation');
  dispose();
  assert.equal(drawer.getAttribute('role'), 'presentation', 'a host write during the open state wins');
  assert.equal(drawer.getAttribute('aria-modal'), null);
  assert.equal(drawer.getAttribute('aria-label'), 'Host sidebar');
  assert.equal(drawer.getAttribute('tabindex'), '0');
  assert.equal(center.hasAttribute('inert'), false);
  assert.equal(bottom.hasAttribute('inert'), false);
  assert.equal(rightbar.hasAttribute('inert'), true, 'a pre-existing inert survives');
});

test('focus enters the open drawer, Tab is trapped and Escape closes once', (t) => {
  const world = createWorld();
  t.after(world.restore);
  const { toggle, first, middle, last } = world.dom;
  toggle.focus();
  const dispose = installDrawerInteraction(world.ctx, 'Navigation');
  assert.equal(world.dom.document.activeElement, first, 'the first focusable drawer control receives focus');

  middle.focus();
  const forward = keydown('Tab');
  world.dom.document.fire('keydown', forward);
  assert.equal(forward.defaultPrevented, false, 'Tab from a middle target is left to the browser');

  last.focus();
  const wrap = keydown('Tab');
  world.dom.document.fire('keydown', wrap);
  assert.equal(wrap.defaultPrevented, true);
  assert.equal(world.dom.document.activeElement, first, 'Tab from the last target wraps to the first');

  first.focus();
  const backward = keydown('Tab', { shiftKey: true });
  world.dom.document.fire('keydown', backward);
  assert.equal(backward.defaultPrevented, true);
  assert.equal(world.dom.document.activeElement, last, 'Shift+Tab from the first target wraps to the last');

  toggle.focus();
  const outside = keydown('Tab');
  world.dom.document.fire('keydown', outside);
  assert.equal(outside.defaultPrevented, true);
  assert.equal(world.dom.document.activeElement, first, 'Tab from outside the drawer is pulled back inside');

  toggle.focus();
  world.dom.document.fire('focusin', { target: toggle });
  assert.equal(world.dom.document.activeElement, first, 'focus escaping the drawer is pulled back inside');

  const escape = keydown('Escape');
  world.dom.document.fire('keydown', escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(escape.propagationStopped, true);
  assert.equal(world.toggles(), 1);

  const secondEscape = keydown('Escape');
  world.dom.document.fire('keydown', secondEscape);
  assert.equal(world.toggles(), 1, 'a second Escape does not issue another toggle');
  dispose();
});

test('disposing returns focus to the toggle, or to the pre-open focus as a fallback', (t) => {
  const world = createWorld();
  t.after(world.restore);
  const { toggle, first, outside } = world.dom;
  outside.focus();
  const dispose = installDrawerInteraction(world.ctx, 'Navigation');
  assert.equal(world.dom.document.activeElement, first);
  dispose();
  assert.equal(world.dom.document.activeElement, toggle, 'the visible header toggle is preferred');

  toggle.remove();
  outside.focus();
  const fallback = installDrawerInteraction(world.ctx, 'Navigation');
  assert.equal(world.dom.document.activeElement, first);
  fallback();
  assert.equal(world.dom.document.activeElement, outside, 'without a toggle, the previous focus is restored');
});

test('portalled menus and dialogs keep their Escape and focus handling', (t) => {
  const world = createWorld();
  t.after(world.restore);
  const { toggle, outside } = world.dom;
  const menu = world.dom.create('div');
  menu.setAttribute('role', 'menu');
  const dialog = world.dom.create('dialog');
  dialog.setAttribute('open', '');
  world.dom.mount(menu, dialog);

  outside.focus();
  const dispose = installDrawerInteraction(world.ctx, 'Navigation');
  assert.equal(world.dom.document.activeElement, outside, 'opening the drawer does not steal focus from a host overlay');

  const escape = keydown('Escape');
  world.dom.document.fire('keydown', escape);
  assert.equal(escape.defaultPrevented, false);
  assert.equal(escape.propagationStopped, false);
  assert.equal(world.toggles(), 0);

  const elsewhere = world.dom.create('button');
  world.dom.mount(elsewhere);
  elsewhere.focus();
  world.dom.document.fire('focusin', { target: elsewhere });
  assert.equal(world.dom.document.activeElement, elsewhere, 'focus is not pulled back while a host overlay is open');

  menu.remove();
  toggle.focus();
  const whileDialog = keydown('Escape');
  world.dom.document.fire('keydown', whileDialog);
  assert.equal(whileDialog.defaultPrevented, false, 'a native dialog keeps Escape too');
  assert.equal(world.toggles(), 0);

  dialog.remove();
  const afterOverlays = keydown('Escape');
  world.dom.document.fire('keydown', afterOverlays);
  assert.equal(afterOverlays.defaultPrevented, true);
  assert.equal(world.toggles(), 1, 'once host overlays are gone the drawer closes again');
  dispose();
});

test('disposing while a host dialog is open restores attributes without stealing its focus', (t) => {
  const world = createWorld();
  t.after(world.restore);
  world.dom.toggle.focus();
  const dispose = installDrawerInteraction(world.ctx, 'Navigation');
  const dialog = world.dom.create('div');
  dialog.setAttribute('role', 'dialog');
  const input = world.dom.create('input');
  dialog.append(input);
  world.dom.mount(dialog);
  input.focus();
  world.dom.document.fire('focusin', { target: input });
  dispose();
  assert.equal(world.dom.document.activeElement, input);
  assert.equal(world.dom.center.hasAttribute('inert'), false);
  assert.equal(world.dom.drawer.getAttribute('aria-modal'), null);
});

test('an unrelated session-list update does not close the drawer', async (t) => {
  const world = createWorld();
  t.after(world.restore);
  const dispose = installDrawerInteraction(world.ctx, 'Navigation');

  world.sessions.set({
    byId: {
      'session-a': { retainedBy: { mainView: 1 } },
      'session-b': { retainedBy: {} },
    },
  });
  await flushMicrotasks();
  assert.equal(world.toggles(), 0, 'a row that never owns the main view is not navigation');
  dispose();
});

test('a main-view switch closes only after the retained projection settles', async (t) => {
  const world = createWorld();
  t.after(world.restore);
  const dispose = installDrawerInteraction(world.ctx, 'Navigation');

  // The host publishes Retain(new) and Release(old) separately. Looking at the
  // first snapshot would still see the old main view and close too late or not at all.
  world.sessions.set({
    byId: {
      'session-a': { retainedBy: { mainView: 1 } },
      'session-b': { retainedBy: { mainView: 1 } },
    },
  });
  world.sessions.set({
    byId: {
      'session-a': { retainedBy: { mainView: 0 } },
      'session-b': { retainedBy: { mainView: 1 } },
    },
  });
  assert.equal(world.toggles(), 0, 'the transient two-main projection is not acted on');

  await flushMicrotasks();
  assert.equal(world.toggles(), 1, 'the settled projection closes the drawer');
  dispose();
});

test('a host panel switch closes the drawer after the microtask', async (t) => {
  const world = createWorld({ panel: 'chat' });
  t.after(world.restore);
  const dispose = installDrawerInteraction(world.ctx, 'Navigation');

  world.panelInfo.set({ activePanelId: 'chat' });
  await flushMicrotasks();
  assert.equal(world.toggles(), 0, 'republishing the same panel is not navigation');

  world.panelInfo.set({ activePanelId: 'settings' });
  assert.equal(world.toggles(), 0, 'the panel close is deferred to the settled projection');
  await flushMicrotasks();
  assert.equal(world.toggles(), 1, 'a different active panel closes the drawer');
  dispose();
});

test('disposing before the queued navigation runs cancels the close and restores the document', async (t) => {
  const world = createWorld();
  t.after(world.restore);
  const { drawer, center } = world.dom;
  const dispose = installDrawerInteraction(world.ctx, 'Navigation');
  world.sessions.set({ byId: { 'session-a': { retainedBy: { mainView: 0 } }, 'session-b': { retainedBy: { mainView: 1 } } } });

  dispose();
  await flushMicrotasks();
  assert.equal(world.toggles(), 0, 'a queued navigation does not close after disposal');

  world.sessions.set({ byId: { 'session-a': { retainedBy: { mainView: 1 } } } });
  await flushMicrotasks();
  assert.equal(world.toggles(), 0, 'the disposed interaction no longer listens');
  assert.equal(world.sessions.listenerCount, 0);
  assert.equal(world.panelInfo.listenerCount, 0);
  assert.equal(world.dom.document.listenerCount('keydown'), 0);
  assert.equal(world.dom.document.listenerCount('focusin'), 0);
  assert.equal(drawer.getAttribute('role'), null);
  assert.equal(drawer.getAttribute('aria-modal'), null);
  assert.equal(drawer.getAttribute('tabindex'), null);
  assert.equal(center.hasAttribute('inert'), false);
});
