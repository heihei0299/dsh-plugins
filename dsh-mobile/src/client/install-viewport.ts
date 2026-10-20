import type { Disposer } from './contracts.js';

/**
 * Extend the document's viewport meta so the page can use the full screen.
 *
 * - `viewport-fit=cover` lets the safe-area insets resolve to real values
 *   instead of zero, so the stylesheet's `env()` padding does something.
 * - `interactive-widget=resizes-content` makes Android resize the layout
 *   viewport for the keyboard instead of scrolling the page under it.
 *
 * iOS ignores `interactive-widget`; `installKeyboardInset` covers that case.
 * An existing node always stays in the document: disposal restores its original
 * content attribute verbatim, or removes the attribute again when it was absent.
 * @returns a disposer restoring the original meta content.
 */
export function installViewport(): Disposer {
  const head = document.head;
  const existing = head.querySelector('meta[name="viewport"]');
  const previous = existing?.getAttribute('content') ?? null;
  const tag = existing ?? document.createElement('meta');
  if (existing === null) {
    tag.setAttribute('name', 'viewport');
    head.appendChild(tag);
  }
  const base = previous ?? 'width=device-width, initial-scale=1';
  const parts = base.split(',').map(part => part.trim()).filter(part => part !== '');
  const without = parts.filter(part => !/^(?:viewport-fit|interactive-widget)\s*=/i.test(part));
  tag.setAttribute('content', [...without, 'viewport-fit=cover', 'interactive-widget=resizes-content'].join(', '));
  return () => {
    if (existing === null) tag.remove();
    else if (previous === null) tag.removeAttribute('content');
    else tag.setAttribute('content', previous);
  };
}
