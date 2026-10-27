import { COLLAPSED_ATTRIBUTE, FRAME, SIDEBAR_COLUMN } from './landmarks.js';
import { overlayOnScreen } from './install-drawer.js';
import type { ClientContext, Disposer } from './contracts.js';

/**
 * Horizontal travel a touch must cover before it counts as a navigation swipe.
 * Long enough that a tap or a shaky finger never opens the drawer, short enough
 * that half a phone width (390px) is not required.
 */
export const SWIPE_MIN_PX = 60;
/**
 * How much more horizontal than vertical the gesture must be.
 *
 * Scrolling the session list is the dominant gesture in this region, so a
 * diagonal drag has to resolve to the scroller, not to the navigation.
 */
export const SWIPE_SLOPE = 1.5;

/**
 * Elements whose own touch handling owns the gesture.
 *
 * Form fields select text and place a caret; the drawer's scrim and toggle are
 * this plugin's own navigation controls, and a swipe that starts on them has
 * already been answered.
 */
const OWNS_TOUCH = 'input,textarea,select,[contenteditable="true"],.dsh-mobile-scrim,.dsh-mobile-toggle';

/** What a completed horizontal gesture asks the layout to do. */
export type SwipeAction = 'open' | 'close' | 'ignore';

/**
 * Decide what one released gesture means.
 *
 * Pure so the thresholds are testable without a touch stack.
 * @param input - horizontal and vertical travel plus the drawer's current state.
 * @returns the action to apply.
 */
export function swipeAction(input: { dx: number; dy: number; collapsed: boolean }): SwipeAction {
  const { dx, dy, collapsed } = input;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return 'ignore';
  if (Math.abs(dx) < SWIPE_MIN_PX) return 'ignore';
  if (Math.abs(dx) < Math.abs(dy) * SWIPE_SLOPE) return 'ignore';
  // Right opens, left closes — and a gesture asking for the state the drawer is
  // already in is not a command.
  if (dx > 0) return collapsed ? 'open' : 'ignore';
  return collapsed ? 'ignore' : 'close';
}

/**
 * Whether the gesture started inside something that scrolls horizontally.
 *
 * Judged at release, and only for a gesture that already qualified: walking the
 * ancestor chain forces a style recalc plus a synchronous layout, which must not
 * happen on every tap and scroll-start.
 * @param element - the touch target.
 * @returns true when the gesture belongs to a horizontal scroller.
 */
export function insideHorizontalScroller(element: Element): boolean {
  let current: Element | null = element;
  while (current !== null && current !== document.body) {
    const style = getComputedStyle(current);
    if ((style.overflowX === 'auto' || style.overflowX === 'scroll') && current.scrollWidth > current.clientWidth + 4) return true;
    current = current.parentElement;
  }
  return false;
}

/**
 * Install swipe navigation on the running SPA.
 *
 * The drawer's open/closed state stays the host's: this layer only reads the
 * frame's `data-sidebar-collapsed` and asks the public layout face to toggle it.
 * Right swipe opens, left swipe closes; vertical drags, gestures that start on a
 * form field or a plugin control, gestures inside a horizontal scroller, and any
 * gesture while a host dialog/menu is on screen are all left alone.
 * @param ctx - the client context; only `layout.toggleSidebar` is used.
 * @returns a disposer removing every listener.
 */
export function installSwipeNavigation(ctx: ClientContext): Disposer {
  /** The touch that may still become a swipe. */
  let start: { readonly x: number; readonly y: number; readonly id: number; readonly target: Element } | null = null;

  function drawerCollapsed(): boolean {
    const frame = document.querySelector(FRAME);
    return frame?.hasAttribute(COLLAPSED_ATTRIBUTE) !== false;
  }

  function onStart(event: TouchEvent): void {
    // Multi-finger contact is a pinch, never a navigation swipe.
    if (event.touches.length > 1) {
      start = null;
      return;
    }
    const target = event.target;
    const touch = event.changedTouches[0];
    if (!(target instanceof Element) || touch === undefined) {
      start = null;
      return;
    }
    if (target.closest(OWNS_TOUCH) !== null) {
      start = null;
      return;
    }
    start = { x: touch.clientX, y: touch.clientY, id: touch.identifier, target };
  }

  function onMove(event: TouchEvent): void {
    if (start === null) return;
    // A second finger landing mid-gesture turns the rest into a pinch.
    if (event.touches.length > 1) start = null;
  }

  function onEnd(event: TouchEvent): void {
    // The candidate is consumed by the first release either way: keeping it
    // would let a finger that lifted during a pinch answer for a later one.
    const gesture = start;
    start = null;
    if (gesture === null) return;
    // Still more than one finger down: the pinch is in progress, not finished.
    if (event.touches.length > 0) return;
    const touch = event.changedTouches[0];
    if (touch === undefined || touch.identifier !== gesture.id) return;
    const action = swipeAction({
      dx: touch.clientX - gesture.x,
      dy: touch.clientY - gesture.y,
      collapsed: drawerCollapsed(),
    });
    if (action === 'ignore') return;
    // The navigation drawer is itself a host popover while it is open (the
    // narrow layout renders the sidebar column with a `popover` attribute), so
    // the drawer has to be excluded from the overlay guard — otherwise the only
    // gesture that could close it would be the one the guard blocks.
    if (overlayOnScreen(document.querySelector(SIDEBAR_COLUMN))) return;
    if (insideHorizontalScroller(gesture.target)) return;
    ctx.layout.toggleSidebar();
  }

  function onCancel(): void {
    start = null;
  }

  document.addEventListener('touchstart', onStart, { capture: true, passive: true });
  document.addEventListener('touchmove', onMove, { capture: true, passive: true });
  document.addEventListener('touchend', onEnd, { capture: true, passive: true });
  document.addEventListener('touchcancel', onCancel, true);
  return () => {
    document.removeEventListener('touchstart', onStart, { capture: true });
    document.removeEventListener('touchmove', onMove, { capture: true });
    document.removeEventListener('touchend', onEnd, { capture: true });
    document.removeEventListener('touchcancel', onCancel, true);
    start = null;
  };
}
