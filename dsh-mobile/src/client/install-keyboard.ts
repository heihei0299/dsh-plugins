import { KEYBOARD_INSET_VAR } from './styles.js';
import type { Disposer } from './contracts.js';

/** Never reserve more than this fraction of the layout viewport for the keyboard. */
export const MAX_INSET_RATIO = 0.4;
/** Inset changes smaller than this are browser chrome noise, not a keyboard. */
export const NOISE_FLOOR = 24;

export interface ViewportMetrics {
  /** Layout viewport height (`window.innerHeight`). */
  layoutHeight: number;
  /** Visual viewport height; `undefined` when the API is unavailable. */
  visualHeight: number | undefined;
  /** Visual viewport offset from the layout viewport's top edge. */
  visualOffsetTop: number;
  /**
   * Visual viewport zoom (`visualViewport.scale`); absent or invalid values are
   * treated as unzoomed.
   *
   * A valid scale above 1 means the page is pinch-zoomed, so the height
   * difference is not attributed to a keyboard and no inset is written.
   */
  scale?: number;
}

/**
 * Work out how much vertical space the on-screen keyboard currently covers.
 *
 * `innerHeight` keeps the layout viewport; `visualViewport` shrinks when either
 * the keyboard opens or the user pinch-zooms. A valid scale above 1 means the
 * page is zoomed, so the difference is not attributed to a keyboard: no inset
 * is inferred and the browser's native focus/pan handling stays in charge.
 * When scale is absent, invalid or not above 1, the original layout/visual
 * difference and 40% cap apply. Small differences are browser chrome (URL bar
 * collapse), and the result is capped so a buggy or absent API cannot reserve
 * the whole screen.
 * @param metrics - measured viewport numbers.
 * @returns the inset in whole px, `0` when nothing should be reserved.
 */
export function computeKeyboardInset(metrics: ViewportMetrics): number {
  const { layoutHeight, visualHeight, visualOffsetTop, scale } = metrics;
  if (visualHeight === undefined || !Number.isFinite(visualHeight) || !Number.isFinite(layoutHeight)) return 0;
  if (layoutHeight <= 0) return 0;
  // Page zoom also shrinks the visual viewport; never infer a keyboard from it.
  if (scale !== undefined && Number.isFinite(scale) && scale > 1) return 0;
  const covered = layoutHeight - visualHeight - (Number.isFinite(visualOffsetTop) ? visualOffsetTop : 0);
  if (!Number.isFinite(covered) || covered <= NOISE_FLOOR) return 0;
  const capped = Math.min(covered, Math.floor(layoutHeight * MAX_INSET_RATIO));
  return Math.max(0, Math.round(capped));
}

/**
 * Keep `--dsh-mobile-kb-inset` on the document root in sync with the keyboard.
 *
 * Runs only while the mobile layout is active; the variable is the single seam
 * the stylesheet reads, so no layout is animated imperatively here. Listeners
 * live on `visualViewport` when available and fall back to window `resize`, so
 * rotation and desktop window resizing behave the same way. The visual
 * viewport's `resize`/`scroll` events fire at pointer frequency, so they only
 * queue one animation frame and the variable is written only when the computed
 * inset changes. The first measurement is synchronous, so the initial state is
 * correct before the first paint rather than one frame later.
 * @param view - the visual viewport, or `undefined` in browsers without it.
 * @returns a disposer removing the listeners, cancelling a pending frame, and
 *   clearing the variable.
 */
export function installKeyboardInset(view: VisualViewport | null | undefined = globalThis.visualViewport): Disposer {
  const root = document.documentElement;
  const visual = view ?? undefined;
  let frame: number | undefined;
  let disposed = false;
  /** Last value written to the root; `undefined` means nothing was written yet. */
  let applied: number | undefined;
  const sync = (): void => {
    frame = undefined;
    if (disposed) return;
    const inset = computeKeyboardInset({
      layoutHeight: globalThis.innerHeight,
      visualHeight: visual?.height,
      visualOffsetTop: visual?.offsetTop ?? 0,
      scale: visual?.scale,
    });
    if (inset === applied) return;
    applied = inset;
    if (inset === 0) root.style.removeProperty(KEYBOARD_INSET_VAR);
    else root.style.setProperty(KEYBOARD_INSET_VAR, `${inset}px`);
  };
  const schedule = (): void => {
    if (disposed || frame !== undefined) return;
    frame = globalThis.requestAnimationFrame(sync);
  };
  const target: Pick<VisualViewport, 'addEventListener' | 'removeEventListener'> = visual ?? globalThis;
  target.addEventListener('resize', schedule);
  // Without a visual viewport, scrolling cannot change `innerHeight`; only resizing can.
  if (visual !== undefined) target.addEventListener('scroll', schedule);
  sync();
  return () => {
    disposed = true;
    target.removeEventListener('resize', schedule);
    if (visual !== undefined) target.removeEventListener('scroll', schedule);
    if (frame !== undefined) {
      globalThis.cancelAnimationFrame(frame);
      frame = undefined;
    }
    root.style.removeProperty(KEYBOARD_INSET_VAR);
  };
}
