import type { ClientContext, Disposer } from './contracts.js';
import { CENTER_COLUMN, RIGHTBAR_COLUMN, SIDEBAR_COLUMN } from './landmarks.js';
import { isDrawerClosed } from './environment.js';

export const DRAWER_ID = 'dsh-mobile-drawer';
const TOGGLE = '.dsh-mobile-toggle';
const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[contenteditable="true"],[tabindex]';
// Host menus/dialogs can be portalled outside the sidebar. Their own keyboard
// and focus policies take precedence over the navigation drawer's policy.
export const OVERLAYS = '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],dialog[open],[popover]';

/**
 * Whether any host overlay is currently on screen.
 *
 * Membership of {@link OVERLAYS} is not enough: `[popover]` also matches a
 * closed popover (this plugin's own status panel is one), so the answer is
 * "painted right now", the same test the drawer's focus policy uses.
 * @param exclude - a subtree to ignore, typically the navigation drawer.
 * @returns true when at least one matched element outside `exclude` has a layout box.
 */
export function overlayOnScreen(exclude: Element | null = null): boolean {
  return Array.from(document.querySelectorAll(OVERLAYS)).some(element =>
    element.getClientRects().length > 0 && (exclude === null || (!exclude.contains(element) && element !== exclude)));
}

function attributes(element: HTMLElement, values: Record<string, string>): Disposer {
  const previous = Object.keys(values).map(name => [name, element.getAttribute(name)] as const);
  for (const [name, value] of Object.entries(values)) element.setAttribute(name, value);
  return () => {
    for (const [name, value] of previous) {
      if (element.getAttribute(name) !== values[name]) continue;
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    }
  };
}

/** Give aria-controls a real DOM target, including while the drawer is closed. */
export function installDrawerTarget(): Disposer {
  const drawer = document.querySelector<HTMLElement>(SIDEBAR_COLUMN);
  return drawer === null ? () => {} : attributes(drawer, { id: DRAWER_ID });
}

function visible(element: HTMLElement): boolean {
  return element.isConnected && element.closest('[inert],[hidden]') === null &&
    element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible';
}

function focusable(drawer: HTMLElement): HTMLElement[] {
  return Array.from(drawer.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && visible(element));
}

function mainSession(ctx: ClientContext): string | undefined {
  return Object.entries(ctx.sessions.list.getSnapshot().byId)
    .find(([, row]) => (row.retainedBy.mainView ?? 0) > 0)?.[0];
}

/**
 * Open-drawer behaviour only. The host still owns expanded state; this layer
 * adds modal focus, Escape and close-on-committed-navigation, not a second state.
 */
export function installDrawerInteraction(ctx: ClientContext, label: string): Disposer {
  const drawer = document.querySelector<HTMLElement>(SIDEBAR_COLUMN);
  if (drawer === null) return () => {};
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const restoreDialog = attributes(drawer, {
    role: 'dialog', 'aria-modal': 'true', 'aria-label': label, tabindex: '-1',
  });
  const restoreBackground = Array.from(document.querySelectorAll<HTMLElement>(
    `${CENTER_COLUMN},${RIGHTBAR_COLUMN},[data-slot="root"] > div > [data-shell-bottom]`,
  )).map(element => attributes(element, { inert: '' }));
  let disposed = false;
  let closing = false;
  let navigationQueued = false;
  const session = mainSession(ctx);
  const panel = ctx.layout.panelInfo.getSnapshot().activePanelId;
  const close = (): void => {
    if (disposed || closing || isDrawerClosed()) return;
    closing = true;
    ctx.layout.toggleSidebar();
  };
  const nestedOverlay = (): boolean => Array.from(document.querySelectorAll<HTMLElement>(OVERLAYS))
    .some(element => element !== drawer && visible(element));
  const focusEdge = (last = false): void => {
    const targets = focusable(drawer);
    (last ? targets.at(-1) ?? drawer : targets[0] ?? drawer).focus({ preventScroll: true });
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' && event.key !== 'Tab') return;
    if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || nestedOverlay()) return;
    if (event.key === 'Escape' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      const targets = focusable(drawer);
      const active = document.activeElement;
      if (targets.length === 0 || !drawer.contains(active) || active === drawer ||
          (event.shiftKey ? active === targets[0] : active === targets.at(-1))) {
        event.preventDefault();
        focusEdge(event.shiftKey);
      }
    }
  };
  const onFocus = (event: FocusEvent): void => {
    if (!drawer.contains(event.target as Node | null) && !nestedOverlay()) focusEdge();
  };
  const onNavigation = (): void => {
    if (navigationQueued || disposed) return;
    navigationQueued = true;
    // Retain(new mainView) and release(old mainView) publish separately. Inspect
    // their settled projection, never a transient two-current-session snapshot.
    queueMicrotask(() => {
      navigationQueued = false;
      if (disposed) return;
      const nextSession = mainSession(ctx);
      if ((nextSession !== undefined && nextSession !== session) ||
          ctx.layout.panelInfo.getSnapshot().activePanelId !== panel) close();
    });
  };
  const offSessions = ctx.sessions.list.subscribe(onNavigation);
  const offPanels = ctx.layout.panelInfo.subscribe(onNavigation);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('focusin', onFocus);
  if (!nestedOverlay()) focusEdge();
  return () => {
    disposed = true;
    offSessions();
    offPanels();
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('focusin', onFocus);
    restoreDialog();
    restoreBackground.reverse().forEach(restore => restore());
    // Turning this plugin off from a host dialog must not steal that dialog's
    // focus while restoring the sidebar/background attributes.
    if (nestedOverlay()) return;
    // A successful global-panel navigation may have unmounted the header toggle.
    // Do not return focus into the now-hidden sidebar or force the editor open.
    const toggle = document.querySelector<HTMLElement>(TOGGLE);
    const target = toggle !== null && visible(toggle) ? toggle :
      previousFocus !== null && !drawer.contains(previousFocus) && visible(previousFocus) ? previousFocus : null;
    if (target !== null) target.focus({ preventScroll: true });
    else {
      const main = document.querySelector<HTMLElement>(CENTER_COLUMN);
      if (main !== null && visible(main)) {
        const restore = attributes(main, { tabindex: '-1' });
        main.focus({ preventScroll: true });
        restore();
      }
    }
  };
}
