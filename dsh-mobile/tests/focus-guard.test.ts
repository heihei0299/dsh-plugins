import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FOCUS_INTENT_MS, installComposerFocusGuard, isComposerField, shouldDeferComposerFocus,
} from '../src/client/install-focus-guard.js';

/* ------------------------------------------------------------------------- *
 * The guard's whole surface is `HTMLElement.prototype.focus` plus one document
 * listener, so the fake is a class hierarchy: `Element` answers the `instanceof`
 * test the guard performs, `HTMLElement` carries the patched method.
 * ------------------------------------------------------------------------- */

class FakeElement {
  readonly attributes = new Map<string, string>();
  /** Inside the composer card, as `closest(COMPOSER_CARD)` sees it. */
  inComposer = false;
  /** The editing surface itself, as `matches(COMPOSER_INPUT)` sees it. */
  isEditor = false;

  constructor(readonly tagName = 'div') {}

  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  closest(_selector: string): FakeElement | null { return this.inComposer ? this : null; }
  matches(_selector: string): boolean { return this.isEditor; }
}

class FakeHTMLElement extends FakeElement {
  focused = 0;

  focus(_options?: FocusOptions): void { this.focused += 1; }
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

function createDocument() {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  return {
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
}

/** The editor the host focuses when a session opens. */
function editor(): FakeHTMLElement {
  const element = new FakeHTMLElement('div');
  element.inComposer = true;
  element.isEditor = true;
  return element;
}

test('a focus request is deferred unless the composer was touched just before', () => {
  assert.equal(shouldDeferComposerFocus({ now: 10_000, lastIntentAt: 0 }), true);
  assert.equal(shouldDeferComposerFocus({ now: 10_000, lastIntentAt: 10_000 - FOCUS_INTENT_MS + 1 }), false);
  assert.equal(shouldDeferComposerFocus({ now: 10_000, lastIntentAt: 10_000 - FOCUS_INTENT_MS }), true);
});

test('only the composer editing surface is guarded', (t) => {
  t.after(installGlobals({ HTMLElement: FakeHTMLElement, Element: FakeElement }));
  assert.equal(isComposerField(editor() as unknown as Element), true);
  const plain = new FakeHTMLElement('div');
  assert.equal(isComposerField(plain as unknown as Element), false, 'an unrelated element never raises the keyboard');
  const outside = new FakeHTMLElement('textarea');
  assert.equal(isComposerField(outside as unknown as Element), false, 'a textarea outside the composer is not the composer');
  assert.equal(isComposerField(null), false);
});

test('opening a session no longer focuses the composer, a tap still does', (t) => {
  const document = createDocument();
  const restore = installGlobals({ HTMLElement: FakeHTMLElement, Element: FakeElement, document });
  const dispose = installComposerFocusGuard();
  t.after(() => { dispose(); restore(); });
  const field = editor();

  // The host's session-open effect: no touch has happened, so nothing raises the
  // on-screen keyboard.
  field.focus({ preventScroll: true });
  assert.equal(field.focused, 0);

  // The user taps the composer, then the host (or a plugin) focuses it.
  document.fire('pointerdown', { target: field });
  field.focus();
  assert.equal(field.focused, 1);
});

test('the guard never touches focus outside the composer', (t) => {
  const document = createDocument();
  const restore = installGlobals({ HTMLElement: FakeHTMLElement, Element: FakeElement, document });
  const dispose = installComposerFocusGuard();
  t.after(() => { dispose(); restore(); });
  const button = new FakeHTMLElement('button');
  button.focus();
  assert.equal(button.focused, 1);
  const textarea = new FakeHTMLElement('textarea');
  textarea.focus();
  assert.equal(textarea.focused, 1, 'a settings or queue textarea keeps its autofocus');
});

test('disposal restores the original method and removes the listener', (t) => {
  const document = createDocument();
  const original = FakeHTMLElement.prototype.focus;
  const restore = installGlobals({ HTMLElement: FakeHTMLElement, Element: FakeElement, document });
  t.after(restore);
  const dispose = installComposerFocusGuard();
  assert.notEqual(FakeHTMLElement.prototype.focus, original);
  assert.equal(document.listenerCount('pointerdown'), 1);
  dispose();
  assert.equal(FakeHTMLElement.prototype.focus, original);
  assert.equal(document.listenerCount('pointerdown'), 0);
});

test('a patch installed by another plugin survives this one being disabled', (t) => {
  const document = createDocument();
  const original = FakeHTMLElement.prototype.focus;
  const restore = installGlobals({ HTMLElement: FakeHTMLElement, Element: FakeElement, document });
  t.after(() => { FakeHTMLElement.prototype.focus = original; restore(); });
  const dispose = installComposerFocusGuard();
  const foreign = function foreign(this: FakeHTMLElement): void { this.focused += 100; };
  FakeHTMLElement.prototype.focus = foreign;
  dispose();
  assert.equal(FakeHTMLElement.prototype.focus, foreign, 'disabling this layer must not remove someone else’s behaviour');
});
