import * as React from 'react';
import { ActivationContext, useEnvironment } from './environment.js';
import { BADGES_ATTRIBUTE, HEADER_ACTIONS } from './landmarks.js';
import {
  formatCount, jobCounts, subagentCounts, type BadgeCount, type JobRow, type SessionFacts,
} from './status-source.js';

/** Re-exported for tests: the header-slot attribute the stylesheet reads. */
export { BADGES_ATTRIBUTE };

interface PanelRow {
  key: string;
  label: string;
  meta?: string;
  live?: boolean;
  sessionId?: string;
}

/**
 * Collapsed subagent/background-task badges for the mobile conversation header.
 *
 * The host renders both states as long localized labels ("3 个子智能体"), which
 * pushes the session title out of a 390px header. This replaces them with an
 * icon plus a count, and leaves the host's own badges in place: the stylesheet
 * hides a host badge only while this component actually renders a replacement
 * for that category, so a projection this plugin cannot read still falls back
 * to the host's own control instead of showing nothing.
 * @param props - `sessionId` from the host's slot props.
 * @returns the badges, or nothing while the mobile layout is inactive.
 */
export function StatusBadges({ sessionId }: { sessionId?: string }) {
  const { ctx, t } = useEnvironment();
  const activation = React.useContext(ActivationContext);
  // The host's own observables are class instances whose methods read `this`,
  // so they are wrapped rather than passed to useSyncExternalStore unbound.
  const sessionSource = React.useMemo(() => ({
    subscribe: (listener: () => void) => ctx.sessions.list.subscribe(listener),
    getSnapshot: () => ctx.sessions.list.getSnapshot(),
  }), [ctx]);
  const jobSource = React.useMemo(() => ({
    subscribe: (listener: () => void) => ctx.jobs.state.subscribe(listener),
    getSnapshot: () => ctx.jobs.state.getSnapshot(),
  }), [ctx]);
  const sessions = React.useSyncExternalStore(
    sessionSource.subscribe, sessionSource.getSnapshot, sessionSource.getSnapshot,
  ) as SessionFacts;
  const jobs = React.useSyncExternalStore(
    jobSource.subscribe, jobSource.getSnapshot, jobSource.getSnapshot,
  );
  const rootRef = React.useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = React.useState<'subagents' | 'jobs' | null>(null);

  const subagents = React.useMemo(() => subagentCounts(sessions, sessionId), [sessions, sessionId]);
  const background = React.useMemo(
    () => jobCounts(sessionId === undefined ? undefined : jobs.rows[sessionId]),
    [jobs, sessionId],
  );
  const active = activation.active;
  const showSubagents = active && subagents.total > 0;
  const showJobs = active && background.total > 0;

  React.useEffect(() => {
    if (!active || sessionId === undefined) return;
    return ctx.jobs.watchRows(sessionId);
  }, [active, ctx, sessionId]);

  // Announce exactly which host badges this render supersedes.
  React.useEffect(() => {
    const slot = rootRef.current?.closest(HEADER_ACTIONS);
    if (slot === null || slot === undefined) return;
    const categories = [showSubagents ? 'subagents' : '', showJobs ? 'jobs' : ''].filter(Boolean).join(' ');
    if (categories === '') slot.removeAttribute(BADGES_ATTRIBUTE);
    else slot.setAttribute(BADGES_ATTRIBUTE, categories);
    return () => { slot.removeAttribute(BADGES_ATTRIBUTE); };
  }, [showSubagents, showJobs]);

  React.useEffect(() => {
    if (open === null) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      setOpen(null);
    };
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      setOpen(null);
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open]);

  if (!showSubagents && !showJobs) return null;

  const rows = open === 'subagents'
    ? subagentRows(sessions, sessionId, t('badge.subagents.running'))
    : open === 'jobs'
      ? jobRows(sessionId === undefined ? undefined : jobs.rows[sessionId])
      : [];

  return <span className="dsh-mobile-badge-group" ref={rootRef}>
    {showSubagents && <Badge
      kind="subagents"
      icon={<RobotGlyph />}
      count={subagents}
      label={t('badge.subagents', { count: String(subagents.total) })}
      open={open === 'subagents'}
      onToggle={() => { setOpen(current => current === 'subagents' ? null : 'subagents'); }}
    />}
    {showJobs && <Badge
      kind="jobs"
      icon={<StackGlyph />}
      count={background}
      label={t('badge.jobs', { count: String(background.total) })}
      open={open === 'jobs'}
      onToggle={() => { setOpen(current => current === 'jobs' ? null : 'jobs'); }}
    />}
    {open !== null && <BadgePanel
      title={open === 'subagents' ? t('badge.subagents.panel') : t('badge.jobs.panel')}
      empty={t('badge.empty')}
      rows={rows}
      onPick={row => {
        setOpen(null);
        if (row.sessionId === undefined) return;
        ctx.uiWorkspace?.openSession(row.sessionId);
      }}
    />}
  </span>;
}

function Badge({ kind, icon, count, label, open, onToggle }: {
  kind: 'subagents' | 'jobs';
  icon: React.ReactNode;
  count: BadgeCount;
  label: string;
  open: boolean;
  onToggle(): void;
}) {
  return <button
    type="button"
    className={`dsh-mobile-badge dsh-mobile-badge-${kind}`}
    data-live={count.live ? '' : undefined}
    aria-label={label}
    aria-expanded={open}
    aria-haspopup="menu"
    title={label}
    onClick={onToggle}
  >
    {icon}
    <span className="dsh-mobile-badge-count">{formatCount(count.total)}</span>
    {count.live && <span className="dsh-mobile-badge-dot" aria-hidden="true" />}
  </button>;
}

function BadgePanel({ title, empty, rows, onPick }: {
  title: string;
  empty: string;
  rows: readonly PanelRow[];
  onPick(row: PanelRow): void;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, []);
  return <div className="dsh-mobile-badge-panel" role="menu" aria-label={title} ref={ref}>
    <div className="dsh-mobile-badge-panel-title">{title}</div>
    {rows.length === 0
      ? <div className="dsh-mobile-badge-empty">{empty}</div>
      : rows.map(row => <button
        key={row.key}
        type="button"
        role="menuitem"
        className="dsh-mobile-badge-row"
        data-live={row.live ? '' : undefined}
        onClick={() => { onPick(row); }}
      >
        <span className="dsh-mobile-badge-row-dot" aria-hidden="true" />
        <span className="dsh-mobile-badge-row-label">{row.label}</span>
        {row.meta !== undefined && <span className="dsh-mobile-badge-row-meta">{row.meta}</span>}
      </button>)}
  </div>;
}

/**
 * Subagent rows for the panel, in catalog order.
 * @param snapshot - session list snapshot.
 * @param sessionId - the owning session.
 * @param runningLabel - label for a running child.
 * @returns rows; a child with a session id is navigable.
 */
export function subagentRows(
  snapshot: SessionFacts,
  sessionId: string | undefined,
  runningLabel: string,
): PanelRow[] {
  if (sessionId === undefined) return [];
  const entries = snapshot.projectionsBySession?.[sessionId]?.values.subagentCatalog ?? [];
  return entries.map(entry => {
    const live = snapshot.byId?.[entry.id]?.running === true;
    return { key: entry.id, label: entry.label ?? entry.id, live, sessionId: entry.id, ...live ? { meta: runningLabel } : {} };
  });
}

/**
 * Background-job rows for the panel.
 * @param rows - the session's roster.
 * @returns rows; status or progress is the secondary line.
 */
export function jobRows(rows: readonly JobRow[] | undefined): PanelRow[] {
  return (rows ?? []).map(row => ({
    key: row.id,
    label: row.label ?? row.id,
    meta: row.progress ?? row.status,
    live: row.status === 'running' || row.status === 'stopping',
  }));
}

function RobotGlyph() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <rect x="2.6" y="5.2" width="10.8" height="8.2" rx="2.6" />
    <path d="M8 5.2V3.1" /><circle cx="8" cy="2.4" r=".9" fill="currentColor" stroke="none" />
    <circle cx="6" cy="8.7" r=".85" fill="currentColor" stroke="none" />
    <circle cx="10" cy="8.7" r=".85" fill="currentColor" stroke="none" />
    <path d="M2.6 8.4H1.5M13.4 8.4h1.1" />
  </svg>;
}

function StackGlyph() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M8 2.2 2.2 5 8 7.8 13.8 5 8 2.2Z" />
    <path d="M2.2 8.4 8 11.2l5.8-2.8" />
    <path d="M2.2 11.4 8 14.2l5.8-2.8" />
  </svg>;
}
