import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLLAPSED_ATTRIBUTE, FRAME } from '../src/client/landmarks.js';
import {
  COARSE_QUERY, createActivationSource, observeDocumentActivation, type ActivationSource,
} from '../src/client/environment.js';
import type { ConfigForm, ConfigSnapshot, Disposer } from '../src/client/contracts.js';
import { DEFAULT_SETTINGS, type MobileSettings } from '../src/shared/types.js';

/** The Host hands back a fresh value object on every read, exactly like readSettings does. */
function createFakeForm(initial: MobileSettings) {
  let current: MobileSettings = { ...initial };
  let revision = 1;
  const listeners = new Set<() => void>();
  let unsubscribes = 0;
  const form: ConfigForm = {
    getSnapshot: (): ConfigSnapshot => ({ status: 'ready', value: { ...current }, writable: true, revision }),
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); unsubscribes += 1; };
    },
    set: async () => true,
  };
  return {
    form,
    /** Publish a value; the default re-publishes the current fields in fresh objects. */
    publish(next: MobileSettings = current) {
      current = { ...next };
      revision += 1;
      for (const listener of [...listeners]) listener();
    },
    get subscribers() { return listeners.size; },
    get unsubscribes() { return unsubscribes; },
  };
}

function createFakeWindow() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    addEventListener(type: string, listener: () => void) {
      const set = listeners.get(type) ?? new Set<() => void>();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
    fire(type: string) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener();
    },
    count(type: string) { return listeners.get(type)?.size ?? 0; },
  };
}

function createFakeMedia(coarse: boolean) {
  let matches = coarse;
  const listeners = new Set<() => void>();
  return {
    get matches() { return matches; },
    addEventListener(_type: string, listener: () => void) { listeners.add(listener); },
    removeEventListener(_type: string, listener: () => void) { listeners.delete(listener); },
    set(next: boolean) {
      matches = next;
      for (const listener of [...listeners]) listener();
    },
    get listenerCount() { return listeners.size; },
  };
}

interface FakeObserver {
  target: unknown;
  options: MutationObserverInit | undefined;
  readonly disconnected: boolean;
  fire(): void;
}

function createFakeObservers() {
  const instances: FakeObserver[] = [];
  class FakeMutationObserver implements FakeObserver {
    target: unknown;
    options: MutationObserverInit | undefined;
    disconnected = false;
    constructor(private readonly callback: () => void) { instances.push(this); }
    observe(target: unknown, options?: MutationObserverInit): void {
      this.target = target;
      this.options = options;
    }
    disconnect(): void { this.disconnected = true; }
    fire(): void { if (!this.disconnected) this.callback(); }
  }
  return {
    Class: FakeMutationObserver as unknown as typeof MutationObserver,
    instances,
    get active() { return instances.filter(instance => !instance.disconnected); },
    fire() { for (const instance of instances) instance.fire(); },
  };
}

function createFakeFrame(collapsed: boolean) {
  let state = collapsed;
  return {
    get collapsed() { return state; },
    hasAttribute(name: string) { return name === COLLAPSED_ATTRIBUTE ? state : false; },
    set(next: boolean) { state = next; },
  };
}

function createFakeDocument(frame: ReturnType<typeof createFakeFrame>) {
  const selectors: string[] = [];
  return {
    documentElement: {},
    querySelector(selector: string) { selectors.push(selector); return selector === FRAME ? frame : null; },
    selectors,
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

interface Harness {
  source: ActivationSource;
  form: ReturnType<typeof createFakeForm>;
  frame: ReturnType<typeof createFakeFrame>;
  windowEvents: ReturnType<typeof createFakeWindow>;
  media: ReturnType<typeof createFakeMedia>;
  observers: ReturnType<typeof createFakeObservers>;
  document: ReturnType<typeof createFakeDocument>;
  mediaQueries: string[];
  setWidth(width: number): void;
  teardown(): void;
  cleanup(): void;
}

function createHarness(options: { width?: number; coarse?: boolean; collapsed?: boolean; settings?: MobileSettings } = {}): Harness {
  const form = createFakeForm(options.settings ?? DEFAULT_SETTINGS);
  const windowEvents = createFakeWindow();
  const media = createFakeMedia(options.coarse ?? false);
  const observers = createFakeObservers();
  const frame = createFakeFrame(options.collapsed ?? true);
  const fakeDocument = createFakeDocument(frame);
  const mediaQueries: string[] = [];
  const restoreGlobals = installGlobals({
    innerWidth: options.width ?? 390,
    matchMedia: (query: string) => { mediaQueries.push(query); return media; },
    addEventListener: windowEvents.addEventListener,
    removeEventListener: windowEvents.removeEventListener,
    MutationObserver: observers.Class,
    document: fakeDocument,
  });
  let teardown: Disposer | undefined;
  const source = createActivationSource(form.form, factory => {
    const disposer = factory();
    teardown = disposer;
    return disposer;
  });
  return {
    source,
    form,
    frame,
    windowEvents,
    media,
    observers,
    document: fakeDocument,
    mediaQueries,
    setWidth(width: number) { globalThis.innerWidth = width; },
    teardown() { teardown?.(); teardown = undefined; },
    cleanup() { teardown?.(); teardown = undefined; restoreGlobals(); },
  };
}

/** The same coordinator index.tsx installs, with an install callback we can count. */
function observeEffects(source: ActivationSource, log: string[]) {
  return observeDocumentActivation(source, settings => {
    log.push(`install:${settings.drawerNavigation}:${settings.comfortableTargets}`);
    return () => { log.push('dispose'); };
  }, factory => factory());
}

test('unchanged settings never wake subscribers, even with fresh Host objects', (t) => {
  const h = createHarness();
  t.after(h.cleanup);
  assert.equal(h.source.getSnapshot().active, true);
  const published = h.source.getSnapshot();
  let notifications = 0;
  h.source.subscribe(() => { notifications += 1; });

  h.windowEvents.fire('resize');
  h.setWidth(390);
  h.windowEvents.fire('resize');
  h.form.publish();
  h.media.set(true);
  h.setWidth(1440);
  h.windowEvents.fire('resize');
  h.observers.fire();

  assert.equal(notifications, 0, 'unchanged facts must not notify');
  assert.equal(h.source.getSnapshot(), published, 'the published snapshot identity stays stable');
  assert.deepEqual(h.mediaQueries, h.mediaQueries.map(() => COARSE_QUERY));
  assert.ok(h.mediaQueries.length >= 2);

  h.teardown();
  assert.equal(h.windowEvents.count('resize'), 0, 'the resize listener is removed');
  assert.equal(h.media.listenerCount, 0, 'the media listener is removed');
  assert.equal(h.observers.active.length, 0, 'the observer is disconnected');
  assert.equal(h.form.subscribers, 0, 'the form subscription is removed');
  assert.equal(h.form.unsubscribes, 1, 'the form subscription is removed once');
});

test('drawer changes wake React without reinstalling document effects', (t) => {
  const h = createHarness();
  t.after(h.cleanup);
  const log: string[] = [];
  const disposeEffects = observeEffects(h.source, log);
  assert.deepEqual(log, ['install:true:true']);

  let renders = 0;
  h.source.subscribe(() => { renders += 1; });

  h.frame.set(false);
  h.observers.fire();
  assert.equal(renders, 1);
  assert.equal(h.source.getSnapshot().drawerClosed, false);
  assert.deepEqual(log, ['install:true:true'], 'opening the drawer is a React-only change');

  h.windowEvents.fire('resize');
  h.form.publish();
  assert.equal(renders, 1, 'no further wake-ups without a real change');
  assert.deepEqual(log, ['install:true:true']);

  h.frame.set(true);
  h.observers.fire();
  assert.equal(renders, 2);
  assert.deepEqual(log, ['install:true:true'], 'closing the drawer does not reinstall either');

  const [observer] = h.observers.instances;
  assert.ok(h.document.selectors.includes(FRAME), 'the drawer state comes from the host frame, not private state');
  assert.equal(observer?.target, h.document.documentElement);
  assert.deepEqual(observer?.options, { subtree: true, attributeFilter: [COLLAPSED_ATTRIBUTE] });

  disposeEffects();
  assert.deepEqual(log, ['install:true:true', 'dispose']);
});

test('only settings the installed effects are built from rebuild them', (t) => {
  const h = createHarness();
  t.after(h.cleanup);
  const log: string[] = [];
  const disposeEffects = observeEffects(h.source, log);
  let renders = 0;
  h.source.subscribe(() => { renders += 1; });

  h.form.publish({ ...DEFAULT_SETTINGS, mode: 'on' });
  assert.equal(renders, 1, 'React still sees the new mode');
  assert.deepEqual(log, ['install:true:true'], 'mode only decided active; the styles are unchanged');

  h.form.publish({ ...DEFAULT_SETTINGS, drawerNavigation: false });
  assert.equal(renders, 2);
  assert.deepEqual(log, ['install:true:true', 'dispose', 'install:false:true']);

  h.form.publish({ ...DEFAULT_SETTINGS, drawerNavigation: false, comfortableTargets: false });
  assert.equal(renders, 3);
  assert.deepEqual(log, [
    'install:true:true', 'dispose', 'install:false:true', 'dispose', 'install:false:false',
  ]);

  // The interaction switches own document listeners and a prototype patch too,
  // so moving either one has to rebuild the installed set.
  h.form.publish({ ...DEFAULT_SETTINGS, drawerNavigation: false, comfortableTargets: false, swipeNavigation: false });
  assert.equal(renders, 4);
  assert.deepEqual(log.slice(-2), ['dispose', 'install:false:false']);
  h.form.publish({ ...DEFAULT_SETTINGS, drawerNavigation: false, comfortableTargets: false, swipeNavigation: false, quietComposerFocus: false });
  assert.equal(renders, 5);
  assert.deepEqual(log.slice(-2), ['dispose', 'install:false:false']);

  // Row-action CSS is part of the stylesheet, so it rebuilds as well.
  h.form.publish({ ...DEFAULT_SETTINGS, drawerNavigation: false, rowActionsOnTouch: false });
  assert.equal(renders, 6);
  assert.deepEqual(log.slice(-2), ['dispose', 'install:false:true']);

  disposeEffects();
  assert.equal(log.at(-1), 'dispose');
});

test('activation flips dispose before installing and close hard when inactive', (t) => {
  const h = createHarness({ width: 390 });
  t.after(h.cleanup);
  const log: string[] = [];
  const disposeEffects = observeEffects(h.source, log);
  assert.deepEqual(log, ['install:true:true']);

  h.setWidth(1440);
  h.windowEvents.fire('resize');
  assert.equal(h.source.getSnapshot().active, false);
  assert.equal(h.source.getSnapshot().settings, undefined);
  assert.deepEqual(log, ['install:true:true', 'dispose'], 'deactivation tears down exactly once');

  h.windowEvents.fire('resize');
  h.form.publish();
  assert.deepEqual(log, ['install:true:true', 'dispose'], 'an inactive layout reacts to nothing');

  h.setWidth(390);
  h.windowEvents.fire('resize');
  assert.deepEqual(log, ['install:true:true', 'dispose', 'install:true:true']);

  disposeEffects();
  assert.equal(log.at(-1), 'dispose');
});

test('an initially inactive layout installs nothing until it activates', (t) => {
  const h = createHarness({ width: 1440 });
  t.after(h.cleanup);
  const log: string[] = [];
  const disposeEffects = observeEffects(h.source, log);
  assert.deepEqual(log, []);
  assert.equal(h.source.getSnapshot().active, false);

  h.form.publish({ ...DEFAULT_SETTINGS, drawerNavigation: false });
  assert.deepEqual(log, [], 'settings while inactive install nothing');

  h.setWidth(390);
  h.windowEvents.fire('resize');
  assert.deepEqual(log, ['install:false:true'], 'activation uses the settings that arrived while inactive');

  disposeEffects();
});
