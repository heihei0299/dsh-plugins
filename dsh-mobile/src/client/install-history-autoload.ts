import { CHAT_ANCHOR, CHAT_FLOW, CONVERSATION_SCROLL } from './landmarks.js';
import { mainSession } from './session.js';
import type { ClientContext, Disposer } from './contracts.js';

/**
 * Downward travel at the head that asks for one older history page.
 *
 * At the head there is nothing left to scroll, so any downward movement is
 * deliberate overscroll rather than a candidate scroll; 48px keeps a shaky
 * finger or a tap from paging history while staying shorter than the 60px
 * horizontal navigation swipe.
 */
export const PULL_LOAD_PX = 48;

/**
 * Controls whose own touch handling owns the gesture.
 *
 * The composer is sticky inside the transcript scrollport, so it is reached by
 * the same document-level touch events as the transcript; a pull that starts on
 * an editable field owns text selection and a caret, not history paging. A pull
 * that starts on a button or a link is still a deliberate drag — a tap has no
 * travel — so the host's own pager is not excluded here.
 */
export const OWNS_TOUCH = '[data-composer-seat],input,textarea,select,[contenteditable="true"]';

/** Computed `overflow-y` values that give a box its own vertical pan. */
const SCROLLS_VERTICALLY = new Set(['auto', 'scroll', 'overlay']);

/**
 * Whether a box inside the transcript pans vertically by itself.
 *
 * The computed style is required: a tall unclipped block also reports
 * `scrollHeight > clientHeight`, yet a drag over it still scrolls the
 * transcript.
 * @param element - a candidate between the touch target and the transcript.
 * @returns true when the box is a vertical scroll region with content to pan.
 */
function scrollsVertically(element: HTMLElement): boolean {
  if (!SCROLLS_VERTICALLY.has(getComputedStyle(element).overflowY)) return false;
  return element.scrollHeight - element.clientHeight > 1;
}

/**
 * The innermost box between the touch target and the transcript that scrolls
 * vertically on its own.
 *
 * Cards inside a message (a table, a code block, any bounded region) pan
 * themselves; a drag over one is that box's pan, not a request for older
 * history — even while the transcript below is pinned at its head, and even
 * when the box is already at an edge and the browser chains the rest to the
 * transcript. Selector-free on purpose: no card class has to be known.
 * @param target - the element the touch started on.
 * @param scroller - the conversation scrollport, the walk's outer bound.
 * @returns the owning box, or null when the pan belongs to the transcript.
 */
function nestedScrollRegion(target: Element, scroller: HTMLElement): Element | null {
  for (let node: Element | null = target; node !== null && node !== scroller; node = node.parentElement) {
    if (node instanceof HTMLElement && scrollsVertically(node)) return node;
  }
  return null;
}

/**
 * Accumulate downward travel at the head, ignoring upward movement.
 *
 * Pure so the threshold is testable without a touch stack.
 * @param previous - travel accumulated earlier in this gesture.
 * @param dy - movement of this touch sample, in CSS pixels.
 * @returns travel after this sample, never negative.
 */
export function pullTravel(previous: number, dy: number): number {
  if (!Number.isFinite(dy)) return previous;
  return Math.max(0, previous + dy);
}

interface Anchor {
  readonly key: string;
  readonly offset: number;
}

/**
 * The first measurable row at or below the scrollport's top edge.
 *
 * The host writes the same `data-chat-anchor-key` identity its scroll memory
 * uses, so the row can be found again after history prepends. Rows with no box
 * (a collapsed process group) are skipped rather than measured as zero.
 * @param scroller - the conversation scrollport.
 * @returns the anchor identity and its offset from the scrollport's top edge.
 */
function firstAnchor(scroller: HTMLElement): Anchor | null {
  const viewportTop = scroller.getBoundingClientRect().top;
  for (const row of scroller.querySelectorAll(CHAT_ANCHOR)) {
    const rect = row.getBoundingClientRect();
    const key = row.getAttribute('data-chat-anchor-key');
    if (key === null || rect.height <= 0 || rect.bottom <= viewportTop + 1) continue;
    return { key, offset: rect.top - viewportTop };
  }
  return null;
}

/**
 * Measure a known anchor row after the commit.
 * @param scroller - the conversation scrollport.
 * @param key - the row's host identity.
 * @returns its new offset from the scrollport's top edge, or null when the row is gone.
 */
function anchorOffset(scroller: HTMLElement, key: string): number | null {
  for (const row of scroller.querySelectorAll(CHAT_ANCHOR)) {
    if (row.getAttribute('data-chat-anchor-key') !== key) continue;
    return row.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  }
  return null;
}

/**
 * Page older history in when the reader pulls down at the transcript head.
 *
 * The page itself is requested through the documented session verb
 * (`SessionFace.loadOlder()`), never by clicking the pager or matching its
 * copy. One pull asks for at most one page, only while the session reports
 * `hasMore` and is not already paging, and the reader's place is retained by
 * following the host's own anchor row across the prepend. A drag that belongs
 * to a nested scroll region is left alone. The host's manual pager keeps
 * working exactly as before.
 * @param ctx - the client context; only the main-view session and its history verbs are used.
 * @returns a disposer removing every listener.
 */
export function installHistoryAutoload(ctx: ClientContext): Disposer {
  /** The touch that may still become a pull-to-page gesture. */
  let gesture: {
    readonly scroller: HTMLElement;
    /** Where the touch landed, kept to decide who owns the pan. */
    readonly target: Element;
    readonly id: number;
    lastY: number;
    travel: number;
    consumed: boolean;
    /** Whether the pan owner has been decided for this gesture. */
    resolved: boolean;
  } | null = null;
  /** One outstanding page at a time, independent of the session's own busy flag. */
  let busy = false;

  /** The touch in `list` with the gesture's identity, when it is still down. */
  function touchWith(list: TouchList, id: number): Touch | undefined {
    for (const touch of Array.from(list)) if (touch.identifier === id) return touch;
    return undefined;
  }

  async function loadEarlier(scroller: HTMLElement): Promise<void> {
    if (busy) return;
    const sessionId = mainSession(ctx);
    if (sessionId === undefined) return;
    const session = ctx.sessions.binding(sessionId)?.session;
    if (session === undefined) return;
    const snapshot = session.getSnapshot();
    if (snapshot.openState !== 'open' || !snapshot.hasMore || snapshot.loadingOlder) return;
    const top = scroller.scrollTop;
    if (top > 0.5) return;
    const anchor = firstAnchor(scroller);
    const height = scroller.scrollHeight;
    busy = true;
    try {
      await session.loadOlder();
      // The Host marks the window dirty inside that call; one macrotask later
      // the commit that renders the prepended rows has run.
      await new Promise<void>(resolve => { setTimeout(resolve, 0); });
      // A reader who moved, a new main view or an unmounted transcript owns the
      // scrollport now; do not overwrite their position.
      if (!scroller.isConnected || scroller.scrollTop !== top) return;
      if (mainSession(ctx) !== sessionId) return;
      const moved = anchor === null ? null : anchorOffset(scroller, anchor.key);
      const grown = anchor === null || moved === null
        ? scroller.scrollHeight - height
        : moved - anchor.offset;
      if (grown > 0.5) scroller.scrollTop = top + grown;
    } finally {
      busy = false;
    }
  }

  function onStart(event: TouchEvent): void {
    gesture = null;
    // Multi-finger contact is a pinch, never a history gesture.
    if (event.touches.length > 1) return;
    const target = event.target;
    const touch = event.changedTouches[0];
    if (!(target instanceof Element) || touch === undefined) return;
    if (target.closest(OWNS_TOUCH) !== null) return;
    const scroller = target.closest(CONVERSATION_SCROLL);
    // The scrollport is shared by every conversation view; only the Chat
    // transcript pages through this gesture.
    if (!(scroller instanceof HTMLElement) || scroller.querySelector(CHAT_FLOW) === null) return;
    gesture = { scroller, target, id: touch.identifier, lastY: touch.clientY, travel: 0, consumed: false, resolved: false };
  }

  function onMove(event: TouchEvent): void {
    const active = gesture;
    if (active === null) return;
    // A second finger landing mid-gesture turns the rest into a pinch.
    if (event.touches.length > 1) {
      gesture = null;
      return;
    }
    const touch = touchWith(event.touches, active.id);
    if (touch === undefined) return;
    if (active.scroller.scrollTop > 0.5) {
      // Still travelling up the transcript: the pull only starts counting once
      // the head is reached, not from where the finger first landed.
      active.lastY = touch.clientY;
      active.travel = 0;
      return;
    }
    if (!active.resolved) {
      // A pull is only possible at the head, so the walk happens the first time
      // the finger is actually there rather than on every touch.
      active.resolved = true;
      if (nestedScrollRegion(active.target, active.scroller) !== null) {
        // The card under the finger scrolls itself; history is not this gesture.
        gesture = null;
        return;
      }
    }
    active.travel = pullTravel(active.travel, touch.clientY - active.lastY);
    active.lastY = touch.clientY;
    if (active.consumed || active.travel < PULL_LOAD_PX) return;
    active.consumed = true;
    void loadEarlier(active.scroller);
  }

  function onEnd(event: TouchEvent): void {
    // A remaining finger is a pinch this gesture already declined to answer.
    if (event.touches.length === 0) gesture = null;
  }

  function onCancel(): void {
    gesture = null;
  }

  document.addEventListener('touchstart', onStart, { capture: true, passive: true });
  document.addEventListener('touchmove', onMove, { capture: true, passive: true });
  document.addEventListener('touchend', onEnd, { capture: true, passive: true });
  document.addEventListener('touchcancel', onCancel, { capture: true, passive: true });
  return () => {
    document.removeEventListener('touchstart', onStart, { capture: true });
    document.removeEventListener('touchmove', onMove, { capture: true });
    document.removeEventListener('touchend', onEnd, { capture: true });
    document.removeEventListener('touchcancel', onCancel, { capture: true });
    gesture = null;
  };
}
