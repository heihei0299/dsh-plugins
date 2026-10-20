/**
 * Drawer motion: a compositor-driven slide that survives main-thread stalls.
 *
 * Why this is JavaScript and not a CSS transition: the host unmounts the whole
 * sidebar panel while collapsed and remounts ~561 elements on open, blocking the
 * main thread for 200-370ms. A CSS transition is evaluated against that same
 * stalled pipeline, so it can neither start on time nor keep moving.
 *
 * Two design rules follow, and both exist because the obvious alternative was
 * measured and failed on the live page:
 *
 * 1. The start offset is DERIVED, never read from computed style. The host flips
 *    its collapsed attribute and the stylesheet applies the destination
 *    transform in the same beat, so by the time a mutation notification runs the
 *    computed transform is already the target and a style-based reading yields
 *    zero travel.
 * 2. The slide can be started by the click handler itself, before the host's
 *    React update lands. Waiting for the observer costs at least a frame of
 *    latency, which is exactly what "跟着手走" means to the user.
 *
 * The planner is pure so the interesting decisions (distance, duration,
 * interruption, reduced motion) are unit-testable without a DOM.
 */

/** Opening easing: moves off the tap immediately, then settles. */
export const OPEN_EASING = 'cubic-bezier(.22,.61,.36,1)';
/** Closing easing: slightly quicker, so dismissing never feels sticky. */
export const CLOSE_EASING = 'cubic-bezier(.4,0,.6,1)';
/** Base durations, in ms. Kept short: the host stall is longer than the slide. */
export const OPEN_BASE_MS = 200;
export const CLOSE_BASE_MS = 170;
/**
 * Set on the drawer column only while a slide is running.
 *
 * Scoped to the animation instead of living permanently in the stylesheet:
 * `will-change` held on a 627-element subtree keeps a large compositor layer
 * alive for a control the user touches a few times a minute.
 */
export const SLIDING_ATTRIBUTE = 'data-dsh-mobile-sliding';

export interface DrawerMotionInput {
  /** True when the drawer is moving to the open position. */
  opening: boolean;
  /** Rendered drawer width in px; the closed offset is its negative. */
  width: number;
  /** Current on-screen offset in px (negative = off-screen left). */
  currentPx: number;
  /** The user asked the system to reduce motion. */
  reducedMotion: boolean;
}

export interface DrawerMotion {
  keyframes: { transform: string }[];
  duration: number;
  easing: string;
}

/**
 * Decide how (or whether) to animate one drawer transition.
 *
 * Returns `null` when motion must not run: reduced-motion is on, the element has
 * no measurable width, or it is already at the target. Callers treat `null` as
 * "just apply the final state".
 * @param input - geometry, direction and the user's motion preference.
 * @returns the animation to run, or null.
 */
export function planDrawerMotion(input: DrawerMotionInput): DrawerMotion | null {
  if (input.reducedMotion) return null;
  const width = Number.isFinite(input.width) ? Math.max(0, input.width) : 0;
  if (width < 1) return null;
  const target = input.opening ? 0 : -width;
  // Clamp an interrupted position into the valid range before measuring travel.
  const current = Number.isFinite(input.currentPx) ? Math.min(0, Math.max(-width, input.currentPx)) : target;
  const travel = Math.abs(target - current);
  if (travel < 1) return null;
  const ratio = Math.min(1, travel / width);
  const base = input.opening ? OPEN_BASE_MS : CLOSE_BASE_MS;
  // Short travels finish proportionally faster so a half-open drawer does not
  // crawl through the same fixed duration as a full one.
  const duration = Math.round(base * (0.55 + 0.45 * ratio));
  return {
    keyframes: [{ transform: `translateX(${Math.round(current)}px)` }, { transform: `translateX(${Math.round(target)}px)` }],
    duration,
    easing: input.opening ? OPEN_EASING : CLOSE_EASING,
  };
}

/** The DOM faces the driver needs; all optional so tests can supply nothing. */
export interface MotionHost {
  /** The drawer column element, or null before the frame renders. */
  column(): Element | null;
  /** The user's reduce-motion preference right now. */
  reducedMotion(): boolean;
}

export interface DrawerMotionDriver {
  /**
   * Slide the drawer to `opening`. Safe to call repeatedly.
   * @param opening - target state.
   */
  run(opening: boolean): void;
  /** Target state of the last planned slide, or undefined before the first. */
  readonly target: boolean | undefined;
  /** Cancel any in-flight animation, clear hints and forget the target. */
  dispose(): void;
}

/** Read an element's horizontal offset from its computed transform, or undefined. */
export function readTranslateX(element: Element, width: number): number | undefined {
  const value = globalThis.getComputedStyle(element).transform;
  if (typeof value !== 'string' || value === 'none' || value === '') return undefined;
  const match = /^matrix(?:3d)?\(([^)]+)\)$/.exec(value);
  if (match === null) return undefined;
  const parts = match[1]?.split(',') ?? [];
  // matrix(a,b,c,d,e,f) -> e; matrix3d(...) -> the 13th value.
  const raw = parts.length >= 16 ? parts[12] : parts[4];
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(0, Math.max(-width, parsed));
}

/**
 * Build a driver over one drawer column.
 *
 * The animation uses `fill: 'none'` so the stylesheet remains the source of
 * truth for both end states: the animation only borrows the transform while it
 * runs, and cancelling it can never leave the drawer stuck mid-slide.
 * @param host - element lookup and motion preference.
 * @returns the driver; call `dispose` on teardown.
 */
export function createDrawerMotion(host: MotionHost): DrawerMotionDriver {
  let animation: Animation | undefined;
  let target: boolean | undefined;
  /** Distinguishes an in-flight slide's completion from a newer one's. */
  let generation = 0;

  const clearHints = (element: Element, token: number): void => {
    // A stale completion from the previous slide must not strip the hints of the
    // slide that replaced it mid-flight.
    if (token !== generation) return;
    try { element.removeAttribute(SLIDING_ATTRIBUTE); } catch { /* detached */ }
  };

  return {
    get target() { return target; },
    run(opening: boolean): void {
      const column = host.column();
      if (column === null) return;
      const width = column.getBoundingClientRect().width;
      // Mid-flight, the element is the only authority on where the drawer is;
      // at rest, the committed end position is, and reading style there is the
      // trap documented at the top of this file.
      const interrupted = animation !== undefined;
      const from = (interrupted ? readTranslateX(column, width) : undefined) ?? (opening ? -width : 0);
      animation?.cancel?.();
      animation = undefined;
      target = opening;
      const token = ++generation;
      const plan = planDrawerMotion({ opening, width, currentPx: from, reducedMotion: host.reducedMotion() });
      if (plan === null) { clearHints(column, token); return; }
      column.setAttribute(SLIDING_ATTRIBUTE, '');
      try {
        const started = column.animate(plan.keyframes, { duration: plan.duration, easing: plan.easing, fill: 'none' });
        animation = started;
        const done = (): void => { clearHints(column, token); };
        started.finished?.then(done, done);
        started.onfinish = done;
        started.oncancel = done;
      } catch {
        // No WAAPI (or a detached element): the stylesheet still applies the
        // final position, so the drawer works, just without the slide.
        animation = undefined;
        clearHints(column, token);
      }
    },
    dispose(): void {
      generation += 1;
      const column = host.column();
      animation?.cancel?.();
      animation = undefined;
      target = undefined;
      if (column !== null) {
        try { column.removeAttribute(SLIDING_ATTRIBUTE); } catch { /* detached */ }
      }
    },
  };
}

/**
 * Wire the driver to the host's own collapsed attribute.
 *
 * Observes the document rather than a captured frame so a replaced frame cannot
 * leave the driver bound to a detached node. A slide the click handler already
 * started is not restarted: the driver reports its target and that is the whole
 * check.
 * @param options - document root, lookups, host attribute and motion preference.
 * @returns the driver plus a disposer removing the observer.
 */
export function observeDrawerMotion(options: {
  root: Element;
  frame: () => Element | null;
  column: () => Element | null;
  attribute: string;
  reducedMotion: () => boolean;
}): { driver: DrawerMotionDriver; dispose(): void } {
  const driver = createDrawerMotion({ column: options.column, reducedMotion: options.reducedMotion });
  let collapsed = options.frame()?.hasAttribute(options.attribute) ?? true;
  const observer = new MutationObserver(() => {
    const next = options.frame()?.hasAttribute(options.attribute) ?? true;
    if (next === collapsed) return;
    collapsed = next;
    // Already heading there: an optimistic start from the click handler wins.
    if (driver.target === !next) return;
    driver.run(!next);
  });
  observer.observe(options.root, { subtree: true, attributes: true, attributeFilter: [options.attribute] });
  return {
    driver,
    dispose(): void {
      observer.disconnect();
      driver.dispose();
    },
  };
}
