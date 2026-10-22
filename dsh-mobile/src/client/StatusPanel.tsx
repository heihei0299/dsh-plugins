import * as React from 'react';

export interface StatusPanelRow {
  key: string;
  label: string;
  meta?: string;
  detail?: string;
  live?: boolean;
  tone?: 'live' | 'success' | 'error' | 'neutral';
  sessionId?: string;
}

/** Minimum distance between the popup and any viewport edge, in px. */
export const PANEL_MARGIN = 12;
/** Distance between the anchor icon and the popup, in px. */
export const PANEL_GAP = 8;
/** The popup is a menu-sized card, not a screen-sized sheet. */
export const PANEL_MAX_WIDTH = 360;
export const PANEL_MAX_HEIGHT = 440;

export interface PanelPlacement {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  height: number;
  placement: 'below' | 'above';
}

/**
 * Clamp an icon-anchored popup into the visible viewport.
 *
 * The popup opens directly under the icon, right-aligned so a header badge at
 * the screen edge cannot push it out. Only when there is genuinely more room
 * above the icon than below it does it flip, and the height is capped so the
 * remainder scrolls inside the list instead of leaving the screen.
 * @param anchor - the trigger's viewport rect (right/top/bottom are read).
 * @param viewport - visible viewport, in the same coordinate space.
 * @param naturalHeight - the popup's unclamped height.
 * @returns the absolute top/left/width/max-height to write on the popup.
 */
export function anchoredPanelPosition(
  anchor: Pick<DOMRect, 'right' | 'top' | 'bottom'>,
  viewport: { left: number; top: number; width: number; height: number },
  naturalHeight: number,
): PanelPlacement {
  const width = Math.max(0, Math.min(PANEL_MAX_WIDTH, viewport.width - PANEL_MARGIN * 2));
  const minLeft = viewport.left + PANEL_MARGIN;
  const maxLeft = viewport.left + viewport.width - PANEL_MARGIN - width;
  // Right-align to the icon: header badges sit near the trailing edge, so the
  // popup has to grow towards the middle of the screen.
  const left = Math.max(minLeft, Math.min(anchor.right - width, maxLeft));
  const minTop = viewport.top + PANEL_MARGIN;
  const bottom = viewport.top + viewport.height - PANEL_MARGIN;
  const below = Math.max(0, bottom - anchor.bottom - PANEL_GAP);
  const above = Math.max(0, anchor.top - PANEL_GAP - minTop);
  const placement: PanelPlacement['placement'] = naturalHeight > below && above > below ? 'above' : 'below';
  const maxHeight = Math.max(0, Math.min(PANEL_MAX_HEIGHT, placement === 'above' ? above : below));
  const height = Math.min(Math.max(0, naturalHeight), maxHeight);
  const wanted = placement === 'above' ? anchor.top - PANEL_GAP - height : anchor.bottom + PANEL_GAP;
  const top = Math.max(minTop, Math.min(wanted, bottom - height));
  return { left, top, width, maxHeight, height, placement };
}

/**
 * Non-modal, icon-anchored status popup.
 *
 * It is a `popover="manual"` element, so the browser paints it in the top layer:
 * the host header's `overflow:hidden` and `container-type:inline-size` cannot
 * clip it, and it never becomes a modal sheet with a dimming backdrop. It is
 * dismissed by its close button, the same icon (the caller toggles), another
 * badge (the caller switches), an outside pointer, focus leaving, or Esc.
 * @param props - localized strings, rows and the trigger ref to anchor to.
 * @returns the popup element, or nothing while it is not open.
 */
export function StatusPanel({ id, anchorRef, title, summary, hint, empty, closeLabel, icon, rows, onPick, onDismiss }: {
  id: string;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  title: string;
  summary: string;
  hint: string;
  empty: string;
  closeLabel: string;
  icon: React.ReactNode;
  rows: readonly StatusPanelRow[];
  onPick(row: StatusPanelRow): void;
  onDismiss(): void;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const closeRef = React.useRef<HTMLButtonElement | null>(null);
  React.useLayoutEffect(() => {
    const panel = ref.current;
    const anchor = anchorRef.current;
    if (panel === null || anchor === null) return;
    const visual = window.visualViewport;
    let frame: number | undefined;
    const position = () => {
      frame = undefined;
      const viewport = {
        left: visual?.offsetLeft ?? 0,
        top: visual?.offsetTop ?? 0,
        width: visual?.width ?? window.innerWidth,
        height: visual?.height ?? window.innerHeight,
      };
      // The natural height is the header + hint + the list's FULL content, read
      // without touching `max-height`: unclamping to measure would resize the
      // panel every frame (ResizeObserver) and clamp the list back to the top.
      const list = panel.querySelector<HTMLElement>('.dsh-mobile-badge-panel-list');
      const naturalHeight = list === null
        ? panel.scrollHeight + (panel.offsetHeight - panel.clientHeight)
        : panel.scrollHeight - list.clientHeight + list.scrollHeight + (panel.offsetHeight - panel.clientHeight);
      const placement = anchoredPanelPosition(anchor.getBoundingClientRect(), viewport, naturalHeight);
      panel.style.width = `${placement.width}px`;
      panel.style.left = `${placement.left}px`;
      panel.style.top = `${placement.top}px`;
      panel.style.maxHeight = `${placement.maxHeight}px`;
      panel.dataset.placement = placement.placement;
      panel.style.visibility = 'visible';
    };
    const schedule = () => { frame ??= requestAnimationFrame(position); };
    // Scrolls inside the popup (its own list) must not re-run placement: the
    // card is anchored to its icon, not to the scrolled content.
    const scroll = (event: Event) => {
      if (event.target instanceof Node && panel.contains(event.target)) return;
      schedule();
    };
    const outside = (event: Event) => {
      if (event.target instanceof Node && !panel.contains(event.target) && !anchor.contains(event.target)) onDismiss();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onDismiss();
    };
    // Hidden before the popover is shown, so the unpositioned default (centred
    // in the viewport) is never painted.
    panel.style.visibility = 'hidden';
    panel.showPopover();
    position();
    closeRef.current?.focus({ preventScroll: true });
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', scroll, true);
    visual?.addEventListener('resize', schedule);
    visual?.addEventListener('scroll', schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(panel);
    observer.observe(anchor);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', scroll, true);
      visual?.removeEventListener('resize', schedule);
      visual?.removeEventListener('scroll', schedule);
      const restoreFocus = panel.contains(document.activeElement);
      if (panel.matches(':popover-open')) panel.hidePopover();
      if (restoreFocus && anchor.isConnected) anchor.focus({ preventScroll: true });
    };
  }, [anchorRef, onDismiss]);

  return <div
    id={id}
    ref={ref}
    popover="manual"
    role="dialog"
    aria-modal="false"
    className="dsh-mobile-badge-panel"
    aria-labelledby={`${id}-title`}
    aria-describedby={`${id}-summary`}
  >
    <header className="dsh-mobile-badge-panel-header">
      <span className="dsh-mobile-badge-panel-icon" aria-hidden="true">{icon}</span>
      <div className="dsh-mobile-badge-panel-heading">
        <h2 id={`${id}-title`} className="dsh-mobile-badge-panel-title">{title}</h2>
        <p id={`${id}-summary`} className="dsh-mobile-badge-panel-summary">{summary}</p>
      </div>
      <button type="button" ref={closeRef} className="dsh-mobile-badge-panel-close" aria-label={closeLabel} onClick={onDismiss}>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" /></svg>
      </button>
    </header>
    <p className="dsh-mobile-badge-panel-hint">{hint}</p>
    <ul className="dsh-mobile-badge-panel-list">
      {rows.length === 0
        ? <li className="dsh-mobile-badge-empty">{empty}</li>
        : rows.map(row => {
          const content = <>
            <span className="dsh-mobile-badge-row-body">
              <span className="dsh-mobile-badge-row-label">{row.label}</span>
              {row.meta !== undefined && <span className="dsh-mobile-badge-row-meta" data-tone={row.tone ?? 'neutral'}>
                <span className="dsh-mobile-badge-row-dot" aria-hidden="true" />{row.meta}
              </span>}
              {row.detail !== undefined && <span className="dsh-mobile-badge-row-detail">{row.detail}</span>}
            </span>
            {row.sessionId !== undefined && <svg className="dsh-mobile-badge-row-arrow" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m8 5 5 5-5 5" /></svg>}
          </>;
          return <li key={row.key}>
            {row.sessionId === undefined
              ? <div className="dsh-mobile-badge-row">{content}</div>
              : <button type="button" className="dsh-mobile-badge-row" onClick={() => { onPick(row); }}>{content}</button>}
          </li>;
        })}
    </ul>
  </div>;
}
