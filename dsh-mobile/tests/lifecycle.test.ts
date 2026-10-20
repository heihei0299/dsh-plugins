import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installStyles } from '../src/client/install-styles.js';
import { installViewport } from '../src/client/install-viewport.js';
import { installKeyboardInset } from '../src/client/install-keyboard.js';
import { KEYBOARD_INSET_VAR } from '../src/client/styles.js';

/**
 * Minimal document stand-in: enough to observe exactly what the effects touch.
 * `metaPresent` is separate from `initialViewport` so a test can model an
 * existing meta element whose content attribute is absent.
 */
function fakeDocument(initialViewport: string | null = 'width=device-width, initial-scale=1', metaPresent = initialViewport !== null) {
  const attributes = new Map<string, string>();
  const variables = new Map<string, string>();
  const writes: Array<{ name: string; value: string | null }> = [];
  const styles = new Set<object>();
  const listeners = new Map<string, Set<() => void>>();
  const meta = {
    attribute: initialViewport,
    present: metaPresent,
    setAttribute(name: string, value: string) {
      if (name === 'content') this.attribute = value;
      if (name === 'name') this.present = true;
    },
    getAttribute(name: string) { return name === 'content' ? this.attribute : null; },
    removeAttribute(name: string) { if (name === 'content') this.attribute = null; },
    remove() { this.present = false; this.attribute = null; },
  };
  const document = {
    documentElement: {
      setAttribute: (name: string, value: string) => { attributes.set(name, value); },
      removeAttribute: (name: string) => { attributes.delete(name); },
      style: {
        setProperty: (name: string, value: string) => { writes.push({ name, value }); variables.set(name, value); },
        removeProperty: (name: string) => { writes.push({ name, value: null }); variables.delete(name); },
      },
    },
    head: {
      appendChild: (node: object) => { styles.add(node); },
      querySelector: (selector: string) => (selector === 'meta[name="viewport"]' && meta.present ? meta : null),
    },
    createElement: (tagName: string) => {
      if (tagName === 'meta') return meta;
      const attributes = new Map<string, string>();
      const node = {
        text: '',
        get textContent() { return this.text; },
        set textContent(value: string) { this.text = value; },
        attributes,
        setAttribute(name: string, value: string) { attributes.set(name, value); },
        getAttribute(name: string) { return attributes.get(name) ?? null; },
        remove() { styles.delete(node); },
      };
      return node;
    },
  };
  const target = {
    addEventListener: (type: string, listener: () => void) => {
      const set = listeners.get(type) ?? new Set();
      set.add(listener); listeners.set(type, set);
    },
    removeEventListener: (type: string, listener: () => void) => { listeners.get(type)?.delete(listener); },
  };
  const fire = (type: string) => { for (const listener of [...(listeners.get(type) ?? [])]) listener(); };
  return { document, attributes, variables, writes, styles, meta, target, fire, listeners };
}

/** Animation-frame clock the keyboard installer queues its measurements on. */
function fakeFrames() {
  const queued = new Map<number, (time: number) => void>();
  let next = 1;
  return {
    request(callback: (time: number) => void): number {
      const id = next++;
      queued.set(id, callback);
      return id;
    },
    cancel(id: number): void { queued.delete(id); },
    flush(): void {
      const due = [...queued.values()];
      queued.clear();
      for (const callback of due) callback(0);
    },
    pending(): number { return queued.size; },
  };
}

/** Replace a global for one test and restore absence as absence. */
function stashGlobal(name: string, value: unknown): () => void {
  const globals = globalThis as unknown as Record<string, unknown>;
  const had = name in globals;
  const previous = globals[name];
  globals[name] = value;
  return () => {
    if (had) globals[name] = previous;
    else Reflect.deleteProperty(globals, name);
  };
}

function useFrames(frames: ReturnType<typeof fakeFrames>): () => void {
  const restoreRequest = stashGlobal('requestAnimationFrame', frames.request);
  const restoreCancel = stashGlobal('cancelAnimationFrame', frames.cancel);
  return () => { restoreCancel(); restoreRequest(); };
}

test('styles install and dispose symmetrically', () => {
  const dom = fakeDocument();
  globalThis.document = dom.document as unknown as Document;
  const dispose = installStyles({ drawerNavigation: true, comfortableTargets: true });
  assert.equal(dom.styles.size, 1);
  assert.equal(dom.attributes.get('data-dsh-mobile'), 'drawer');
  const tag = [...dom.styles][0] as { text: string };
  assert.match(tag.text, /md-table-wide/);
  dispose();
  assert.equal(dom.styles.size, 0);
  assert.equal(dom.attributes.size, 0);
});

test('rail mode records a different root state than drawer mode', () => {
  const dom = fakeDocument();
  globalThis.document = dom.document as unknown as Document;
  const dispose = installStyles({ drawerNavigation: false, comfortableTargets: false });
  assert.equal(dom.attributes.get('data-dsh-mobile'), 'rail');
  dispose();
  assert.equal(dom.attributes.size, 0);
});

test('viewport meta is extended in place and restored verbatim', () => {
  const dom = fakeDocument();
  globalThis.document = dom.document as unknown as Document;
  const dispose = installViewport();
  assert.match(dom.meta.attribute ?? '', /viewport-fit=cover/);
  assert.match(dom.meta.attribute ?? '', /interactive-widget=resizes-content/);
  assert.match(dom.meta.attribute ?? '', /^width=device-width, initial-scale=1/);
  dispose();
  assert.equal(dom.meta.attribute, 'width=device-width, initial-scale=1');
});

test('a document without a viewport meta gets one, and loses it again', () => {
  const dom = fakeDocument(null);
  globalThis.document = dom.document as unknown as Document;
  const dispose = installViewport();
  assert.equal(dom.meta.present, true);
  assert.match(dom.meta.attribute ?? '', /width=device-width, initial-scale=1, viewport-fit=cover/);
  dispose();
  assert.equal(dom.meta.present, false);
});

test('existing viewport-fit/interactive-widget values are replaced, not duplicated', () => {
  const dom = fakeDocument('width=device-width, viewport-fit=contain, initial-scale=1, interactive-widget=overlays-content');
  globalThis.document = dom.document as unknown as Document;
  const dispose = installViewport();
  const content = dom.meta.attribute ?? '';
  assert.equal(content.match(/viewport-fit=/g)?.length, 1);
  assert.equal(content.match(/interactive-widget=/g)?.length, 1);
  assert.match(content, /viewport-fit=cover/);
  assert.match(content, /interactive-widget=resizes-content/);
  dispose();
  assert.equal(dom.meta.attribute, 'width=device-width, viewport-fit=contain, initial-scale=1, interactive-widget=overlays-content');
});

test('an existing viewport meta without a content attribute is restored, not removed', () => {
  const dom = fakeDocument(null, true);
  globalThis.document = dom.document as unknown as Document;
  const dispose = installViewport();
  assert.equal(dom.meta.present, true, 'the existing meta stays in place while installed');
  assert.match(dom.meta.attribute ?? '', /width=device-width, initial-scale=1, viewport-fit=cover/);
  dispose();
  assert.equal(dom.meta.present, true, 'the original node stays in the document');
  assert.equal(dom.meta.getAttribute('content'), null, 'the missing attribute remains missing');
});

test('an empty viewport content is restored as an empty attribute', () => {
  const dom = fakeDocument('');
  globalThis.document = dom.document as unknown as Document;
  const dispose = installViewport();
  assert.match(dom.meta.attribute ?? '', /viewport-fit=cover/);
  dispose();
  assert.equal(dom.meta.present, true);
  assert.equal(dom.meta.attribute, '');
});

test('keyboard inset tracks the visual viewport and clears from the document', () => {
  const dom = fakeDocument();
  globalThis.document = dom.document as unknown as Document;
  globalThis.innerHeight = 844;
  const frames = fakeFrames();
  const restoreFrames = useFrames(frames);
  try {
    // The view object doubles as the listener target, like the real VisualViewport.
    const view = { height: 844, offsetTop: 0, scale: 1, ...dom.target };
    const dispose = installKeyboardInset(view as unknown as VisualViewport);
    assert.equal(frames.pending(), 0, 'the initial measurement is synchronous');
    assert.equal(dom.variables.has(KEYBOARD_INSET_VAR), false, 'no inset while the keyboard is closed');
    view.height = 500;
    dom.fire('resize');
    frames.flush();
    assert.equal(dom.variables.get(KEYBOARD_INSET_VAR), `${Math.floor(844 * 0.4)}px`);
    view.height = 844;
    dom.fire('resize');
    frames.flush();
    assert.equal(dom.variables.has(KEYBOARD_INSET_VAR), false);
    view.height = 600;
    dom.fire('resize');
    frames.flush();
    assert.equal(dom.variables.get(KEYBOARD_INSET_VAR), '244px');
    dispose();
    assert.equal(dom.variables.has(KEYBOARD_INSET_VAR), false);
    assert.equal(dom.listeners.get('resize')?.size ?? 0, 0, 'resize listener is removed');
    assert.equal(dom.listeners.get('scroll')?.size ?? 0, 0, 'scroll listener is removed');
  } finally {
    restoreFrames();
  }
});

test('the initial inset is applied synchronously', () => {
  const dom = fakeDocument();
  globalThis.document = dom.document as unknown as Document;
  globalThis.innerHeight = 844;
  const frames = fakeFrames();
  const restoreFrames = useFrames(frames);
  try {
    const view = { height: 500, offsetTop: 0, scale: 1, ...dom.target };
    const dispose = installKeyboardInset(view as unknown as VisualViewport);
    assert.equal(frames.pending(), 0);
    assert.equal(dom.variables.get(KEYBOARD_INSET_VAR), `${Math.floor(844 * 0.4)}px`);
    dispose();
  } finally {
    restoreFrames();
  }
});

test('a zoomed visual viewport clears the inferred keyboard inset', () => {
  const dom = fakeDocument();
  globalThis.document = dom.document as unknown as Document;
  globalThis.innerHeight = 844;
  const frames = fakeFrames();
  const restoreFrames = useFrames(frames);
  try {
    const view = { height: 500, offsetTop: 0, scale: 1, ...dom.target };
    const dispose = installKeyboardInset(view as unknown as VisualViewport);
    assert.equal(dom.variables.get(KEYBOARD_INSET_VAR), `${Math.floor(844 * 0.4)}px`);
    view.scale = 2;
    view.height = 422;
    dom.fire('resize');
    frames.flush();
    assert.equal(dom.variables.has(KEYBOARD_INSET_VAR), false, 'page zoom is not treated as a keyboard');
    view.scale = 1;
    view.height = 600;
    dom.fire('resize');
    frames.flush();
    assert.equal(dom.variables.get(KEYBOARD_INSET_VAR), '244px', 'scale 1 resumes the existing formula');
    dispose();
  } finally {
    restoreFrames();
  }
});

test('high-frequency viewport events share one frame and unchanged insets are not rewritten', () => {
  const dom = fakeDocument();
  globalThis.document = dom.document as unknown as Document;
  globalThis.innerHeight = 844;
  const frames = fakeFrames();
  const restoreFrames = useFrames(frames);
  try {
    const view = { height: 844, offsetTop: 0, scale: 1, ...dom.target };
    const dispose = installKeyboardInset(view as unknown as VisualViewport);
    const initialWrites = dom.writes.length;
    view.height = 500;
    dom.fire('scroll');
    assert.equal(frames.pending(), 1);
    view.height = 600;
    dom.fire('resize');
    assert.equal(frames.pending(), 1, 'resize and scroll are coalesced into one pending frame');
    assert.equal(dom.writes.length, initialWrites, 'nothing is written before the frame runs');
    frames.flush();
    assert.equal(dom.variables.get(KEYBOARD_INSET_VAR), '244px', 'the frame uses the latest measurement');
    const afterChange = dom.writes.length;
    assert.equal(afterChange, initialWrites + 1, 'one frame writes the variable once');
    dom.fire('resize');
    dom.fire('scroll');
    frames.flush();
    assert.equal(dom.writes.length, afterChange, 'an unchanged inset is not written again');
    dispose();
  } finally {
    restoreFrames();
  }
});

test('dispose cancels a queued frame and never writes after teardown', () => {
  const dom = fakeDocument();
  globalThis.document = dom.document as unknown as Document;
  globalThis.innerHeight = 844;
  const frames = fakeFrames();
  const restoreFrames = useFrames(frames);
  try {
    const view = { height: 844, offsetTop: 0, scale: 1, ...dom.target };
    const dispose = installKeyboardInset(view as unknown as VisualViewport);
    const escaped = [...(dom.listeners.get('resize') ?? [])][0];
    assert.ok(escaped);
    view.height = 500;
    dom.fire('resize');
    assert.equal(frames.pending(), 1);
    dispose();
    assert.equal(frames.pending(), 0, 'the pending animation frame is cancelled');
    escaped();
    assert.equal(frames.pending(), 0, 'an event delivered after teardown cannot queue a frame');
    const writes = dom.writes.length;
    frames.flush();
    assert.equal(dom.writes.length, writes, 'a cancelled frame never writes');
    assert.equal(dom.variables.has(KEYBOARD_INSET_VAR), false);
  } finally {
    restoreFrames();
  }
});

test('without a visual viewport only resize is observed', () => {
  const dom = fakeDocument();
  globalThis.document = dom.document as unknown as Document;
  globalThis.innerHeight = 844;
  const frames = fakeFrames();
  const restoreFrames = useFrames(frames);
  const restoreAdd = stashGlobal('addEventListener', dom.target.addEventListener);
  const restoreRemove = stashGlobal('removeEventListener', dom.target.removeEventListener);
  try {
    const dispose = installKeyboardInset(null);
    assert.equal(dom.listeners.get('scroll')?.size ?? 0, 0, 'scroll cannot change innerHeight without a visual viewport');
    assert.equal(dom.listeners.get('resize')?.size, 1);
    dom.fire('resize');
    assert.equal(frames.pending(), 1);
    frames.flush();
    assert.equal(dom.variables.has(KEYBOARD_INSET_VAR), false, 'no visual viewport means no inset');
    dispose();
    assert.equal(dom.listeners.get('resize')?.size ?? 0, 0);
  } finally {
    restoreRemove();
    restoreAdd();
    restoreFrames();
  }
});
