import type { Disposer } from './contracts.js';

/** Stable identity of the one stylesheet this plugin owns for a document. */
export const SMARTUI_STYLE_ATTRIBUTE = 'data-plugin-css';
export const SMARTUI_STYLE_ID = '@local/dsh-smartui/ui.css';

interface StyleLease {
  style: HTMLStyleElement;
  leases: number;
}

const leases = new WeakMap<Document, StyleLease>();

/**
 * Install the SmartUI stylesheet once per document, outside of any Surface.
 *
 * Surfaces may mount and unmount many times during a conversation; the stylesheet
 * belongs to the plugin lifetime instead. A lease count keeps the tag present while
 * any installation is active, and the tag is removed when the last lease is disposed.
 * @param css - bundled stylesheet text.
 * @param doc - document to own the tag; omitted outside a browser.
 * @returns an idempotent disposer for this installation.
 */
export function installStyles(css: string, doc: Document | undefined = globalThis.document): Disposer {
  if (!doc?.head) return () => {};
  let lease = leases.get(doc);
  if (lease && !lease.style.isConnected) {
    leases.delete(doc);
    lease = undefined;
  }
  if (!lease) {
    const existing = doc.querySelector<HTMLStyleElement>(`style[${SMARTUI_STYLE_ATTRIBUTE}="${SMARTUI_STYLE_ID}"]`);
    const style = existing ?? doc.createElement('style');
    if (!existing) {
      style.setAttribute(SMARTUI_STYLE_ATTRIBUTE, SMARTUI_STYLE_ID);
      doc.head.append(style);
    }
    style.textContent = css;
    lease = { style, leases: 0 };
    leases.set(doc, lease);
  }
  const installed = lease;
  installed.leases += 1;
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    installed.leases -= 1;
    if (installed.leases > 0) return;
    installed.style.remove();
    if (leases.get(doc) === installed) leases.delete(doc);
  };
}
