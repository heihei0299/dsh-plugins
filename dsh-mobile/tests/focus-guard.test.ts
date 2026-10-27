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

/* ------------------------------------------------------------------------- *
 * Uninstall order. A later plugin can hold this patch in two shapes: it keeps
 * delegating to the captured function (order A) or it puts the captured
 * function back on the prototype on its way out (order B). Either way the
 * captured closure has to be inert once this install is gone — the property
 * swap alone cannot retire it, and the pointerdown listener is gone by then.
 * ------------------------------------------------------------------------- */

test('uninstall first: a wrapper still delegating to this patch reaches native focus', (t) => {
  const document = createDocument();
  const original = FakeHTMLElement.prototype.focus;
  const restore = installGlobals({ HTMLElement: FakeHTMLElement, Element: FakeElement, document });
  t.after(() => { FakeHTMLElement.prototype.focus = original; restore(); });
  const dispose = installComposerFocusGuard();
  const captured = FakeHTMLElement.prototype.focus;
  const foreign = function foreign(this: FakeHTMLElement, options?: FocusOptions): void {
    captured.call(this, options);
  };
  FakeHTMLElement.prototype.focus = foreign;

  const field = editor();
  field.focus();
  assert.equal(field.focused, 0, 'the patch defers while it is mounted');

  dispose();
  assert.equal(FakeHTMLElement.prototype.focus, foreign, 'the newer wrapper is left in place');
  field.focus();
  assert.equal(field.focused, 1, 'the retired patch must forward the focus it now sees');

  // The wrapper finally gives the prototype back what it captured.
  FakeHTMLElement.prototype.focus = captured;
  field.focus();
  assert.equal(field.focused, 2, 'the captured function carries no mobile behaviour after uninstall');
});

test('uninstall last: the newer wrapper hands the property back before this one is disposed', (t) => {
  const document = createDocument();
  const original = FakeHTMLElement.prototype.focus;
  const restore = installGlobals({ HTMLElement: FakeHTMLElement, Element: FakeElement, document });
  t.after(() => { FakeHTMLElement.prototype.focus = original; restore(); });
  const dispose = installComposerFocusGuard();
  const captured = FakeHTMLElement.prototype.focus;
  FakeHTMLElement.prototype.focus = function foreign(this: FakeHTMLElement, options?: FocusOptions): void {
    captured.call(this, options);
  };

  // The later plugin restores the captured patch, so this layer still owns the
  // property when its own teardown runs.
  FakeHTMLElement.prototype.focus = captured;
  dispose();
  assert.equal(FakeHTMLElement.prototype.focus, original, 'the owner restores the native method');
  assert.equal(document.listenerCount('pointerdown'), 0);

  const field = editor();
  field.focus();
  assert.equal(field.focused, 1, 'nothing defers once the last owner is gone');
});

test('re-enabling installs a fresh policy and retires the previous closure', (t) => {
  const document = createDocument();
  const original = FakeHTMLElement.prototype.focus;
  const restore = installGlobals({ HTMLElement: FakeHTMLElement, Element: FakeElement, document });
  t.after(() => { FakeHTMLElement.prototype.focus = original; restore(); });

  const first = installComposerFocusGuard();
  const retired = FakeHTMLElement.prototype.focus;
  first();
  assert.equal(document.listenerCount('pointerdown'), 0, 'the retired install leaves no listener behind');

  const second = installComposerFocusGuard();
  assert.equal(document.listenerCount('pointerdown'), 1, 'exactly one listener belongs to the live install');

  const field = editor();
  // A stale reference is still reachable in the page (a wrapper captured it, or
  // the host kept a bound copy). It must not apply the old policy.
  retired.call(field);
  assert.equal(field.focused, 1, 'the retired closure no longer intercepts composer focus');

  field.focus();
  assert.equal(field.focused, 1, 'the live install still defers an untapped composer focus');
  document.fire('pointerdown', { target: field });
  field.focus();
  assert.equal(field.focused, 2, 'and it still honours a real tap');

  second();
  assert.equal(FakeHTMLElement.prototype.focus, original, 're-enable then disable still restores the native method');
  field.focus();
  assert.equal(field.focused, 3);
});

test('chained reinstall over a foreign wrapper keeps the retired closure inert', (t) => {
  const document = createDocument();
  const original = FakeHTMLElement.prototype.focus;
  const restore = installGlobals({ HTMLElement: FakeHTMLElement, Element: FakeElement, document });
  t.after(() => { FakeHTMLElement.prototype.focus = original; restore(); });

  // 1. This plugin installs, then a later plugin wraps the captured patch.
  const first = installComposerFocusGuard();
  const retiredPatch = FakeHTMLElement.prototype.focus;
  const foreign = function foreign(this: FakeHTMLElement, options?: FocusOptions): void {
    retiredPatch.call(this, options);
  };
  FakeHTMLElement.prototype.focus = foreign;

  const field = editor();
  field.focus();
  assert.equal(field.focused, 0, 'the first install defers while it is mounted');

  // 2. Disabling it must not leave the wrapper blocked behind a dead closure.
  first();
  assert.equal(FakeHTMLElement.prototype.focus, foreign, 'the later wrapper survives the teardown');
  field.focus();
  assert.equal(field.focused, 1, 'the retired closure forwards through the wrapper');

  // 3. Re-enabling puts a new install on top of the wrapper, so the new guard's
  //    passthrough has to reach the wrapper rather than skipping it, and the
  //    chain must still end at the native method.
  const second = installComposerFocusGuard();
  field.focus();
  assert.equal(field.focused, 1, 'the new install guards the composer again');
  document.fire('pointerdown', { target: field });
  field.focus();
  assert.equal(field.focused, 2, 'a real tap passes through the whole chain');

  // 4. The last teardown leaves the wrapper in place and nothing defers.
  second();
  assert.equal(FakeHTMLElement.prototype.focus, foreign, 'the final teardown does not overwrite the wrapper');
  field.focus();
  assert.equal(field.focused, 3, 'the wrapper still reaches the native method');
});
