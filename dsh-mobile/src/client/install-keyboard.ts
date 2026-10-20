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
}

/**
 * Work out how much vertical space the on-screen keyboard currently covers.
 *
 * `innerHeight` keeps the layout viewport; `visualViewport` shrinks when the
 * keyboard opens. Their difference is the covered band. Small differences are
 * browser chrome (URL bar collapse), and the result is capped so a buggy or
 * absent API cannot reserve the whole screen.
 * @param metrics - measured viewport numbers.
 * @returns the inset in whole px, `0` when nothing should be reserved.
 */
export function computeKeyboardInset(metrics: ViewportMetrics): number {
  const { layoutHeight, visualHeight, visualOffsetTop } = metrics;
  if (visualHeight === undefined || !Number.isFinite(visualHeight) || !Number.isFinite(layoutHeight)) return 0;
  if (layoutHeight <= 0) return 0;
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
 * rotation and desktop window resizing behave the same way.
 * @param view - the visual viewport, or `undefined` in browsers without it.
 * @returns a disposer removing the listeners and the variable.
 */
export function installKeyboardInset(view: VisualViewport | null | undefined = globalThis.visualViewport): Disposer {
  const root = document.documentElement;
  const visual = view ?? undefined;
  const sync = (): void => {
    const inset = computeKeyboardInset({
      layoutHeight: globalThis.innerHeight,
      visualHeight: visual?.height,
      visualOffsetTop: visual?.offsetTop ?? 0,
    });
    if (inset === 0) root.style.removeProperty(KEYBOARD_INSET_VAR);
    else root.style.setProperty(KEYBOARD_INSET_VAR, `${inset}px`);
  };
  const target: Pick<VisualViewport, 'addEventListener' | 'removeEventListener'> = visual ?? globalThis;
  target.addEventListener('resize', sync);
  target.addEventListener('scroll', sync);
  sync();
  return () => {
    target.removeEventListener('resize', sync);
    target.removeEventListener('scroll', sync);
    root.style.removeProperty(KEYBOARD_INSET_VAR);
  };
}
