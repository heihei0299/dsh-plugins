import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installStyles } from '../src/client/install-styles.js';
import { installViewport } from '../src/client/install-viewport.js';
import { installKeyboardInset } from '../src/client/install-keyboard.js';
import { KEYBOARD_INSET_VAR } from '../src/client/styles.js';

/** Minimal document stand-in: enough to observe exactly what the effects touch. */
function fakeDocument(initialViewport: string | null = 'width=device-width, initial-scale=1') {
  const attributes = new Map<string, string>();
  const variables = new Map<string, string>();
  const styles = new Set<object>();
  const listeners = new Map<string, Set<() => void>>();
  const meta = {
    attribute: initialViewport,
    present: initialViewport !== null,
    setAttribute(name: string, value: string) {
      if (name === 'content') { this.attribute = value; this.present = true; }
      if (name === 'name') this.present = true;
    },
    getAttribute(name: string) { return name === 'content' ? this.attribute : null; },
    remove() { this.present = false; this.attribute = null; },
  };
  const document = {
    documentElement: {
      setAttribute: (name: string, value: string) => { attributes.set(name, value); },
      removeAttribute: (name: string) => { attributes.delete(name); },
      style: {
        setProperty: (name: string, value: string) => { variables.set(name, value); },
        removeProperty: (name: string) => { variables.delete(name); },
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
  return { document, attributes, variables, styles, meta, target, fire, listeners };
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

test('keyboard inset tracks the visual viewport and clears from the document', () => {
  const dom = fakeDocument();
  globalThis.document = dom.document as unknown as Document;
  globalThis.innerHeight = 844;
  // The view object doubles as the listener target, like the real VisualViewport.
  const view = { height: 844, offsetTop: 0, ...dom.target } as unknown as VisualViewport;
  const dispose = installKeyboardInset(view);
  assert.equal(dom.variables.has(KEYBOARD_INSET_VAR), false, 'no inset while the keyboard is closed');
  (view as { height: number }).height = 500;
  dom.fire('resize');
  assert.equal(dom.variables.get(KEYBOARD_INSET_VAR), `${Math.floor(844 * 0.4)}px`);
  (view as { height: number }).height = 844;
  dom.fire('resize');
  assert.equal(dom.variables.has(KEYBOARD_INSET_VAR), false);
  (view as { height: number }).height = 600;
  dom.fire('resize');
  assert.equal(dom.variables.get(KEYBOARD_INSET_VAR), '244px');
  dispose();
  assert.equal(dom.variables.has(KEYBOARD_INSET_VAR), false);
  assert.equal(dom.listeners.get('resize')?.size ?? 0, 0, 'listeners are removed');
});
