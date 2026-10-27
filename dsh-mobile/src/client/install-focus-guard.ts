import { COMPOSER_CARD, COMPOSER_INPUT } from './landmarks.js';
import type { Disposer } from './contracts.js';

/**
 * How long after a real tap on the composer a programmatic focus still counts
 * as the user's intent.
 *
 * Long enough to cover the host's own send/refocus sequence (which runs a render
 * pass after the button press), short enough that switching sessions minutes
 * later is not "intent". Measured against the composer interaction, never the
 * clock alone: no tap, no keyboard.
 */
export const FOCUS_INTENT_MS = 3000;

/**
 * The composer's own editing surface.
 *
 * The installed host renders an editor that the user taps directly: a
 * contenteditable carrying `data-composer-input`. A textarea/input inside the
 * composer card is accepted too, so an older composition (or a plugin that
 * replaces the editor) keeps the same policy.
 * @param element - candidate node.
 * @returns true when focusing this node would raise the on-screen keyboard.
 */
export function isComposerField(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  if (element.closest(COMPOSER_CARD) === null) return false;
  if (element.matches(COMPOSER_INPUT)) return true;
  return element.tagName === 'TEXTAREA' || element.tagName === 'INPUT';
}

/**
 * Whether a focus request has to be dropped.
 * @param input - the request time and the last confirmed composer tap.
 * @returns true when nothing in the recent past shows the user asked for it.
 */
export function shouldDeferComposerFocus(input: { now: number; lastIntentAt: number }): boolean {
  return input.now - input.lastIntentAt >= FOCUS_INTENT_MS;
}

/**
 * Stop the host's programmatic composer focus from popping the soft keyboard.
 *
 * The installed host focuses the editor from an effect keyed on
 * `[locked, sessionId, editor]` (ui-conversation's `focusDraftEditor`), so
 * opening or switching a session raises the phone keyboard before the user has
 * touched anything. This patch drops a focus on the composer's editing surface
 * unless the user touched the composer moments before; every other element, and
 * every composer focus that follows a tap (including the send button's own
 * refocus), goes straight to the original implementation.
 *
 * The patch is global, so it is identity-checked on teardown: a patch another
 * plugin installed afterwards is left in place, and the captured original is
 * what gets restored.
 * @returns a disposer restoring `HTMLElement.prototype.focus`.
 */
export function installComposerFocusGuard(): Disposer {
  if (typeof HTMLElement === 'undefined' || typeof document === 'undefined') return () => {};
  const prototype = HTMLElement.prototype;
  const original = prototype.focus;
  /** When the user last touched the composer itself; 0 means never. */
  let lastIntentAt = 0;
  const patched = function focused(this: HTMLElement, options?: FocusOptions): void {
    if (isComposerField(this) && shouldDeferComposerFocus({ now: Date.now(), lastIntentAt })) return;
    original.call(this, options);
  };
  function onPointerDown(event: Event): void {
    const target = event.target;
    if (target instanceof Element && target.closest(COMPOSER_CARD) !== null) lastIntentAt = Date.now();
  }
  prototype.focus = patched;
  document.addEventListener('pointerdown', onPointerDown, true);
  return () => {
    document.removeEventListener('pointerdown', onPointerDown, true);
    if (prototype.focus === patched) prototype.focus = original;
  };
}
