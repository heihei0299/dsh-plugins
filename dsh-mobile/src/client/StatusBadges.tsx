import * as React from 'react';
import { ActivationContext, useEnvironment } from './environment.js';
import { BADGES_ATTRIBUTE, HEADER_ACTIONS } from './landmarks.js';
import type { Translate } from './contracts.js';
import { StatusPanel, type StatusPanelRow as PanelRow } from './StatusPanel.js';
import {
  formatCount, jobCounts, subagentCounts, type BadgeCount, type JobRow, type SessionFacts,
} from './status-source.js';

/** Re-exported for tests: the header-slot attribute the stylesheet reads. */
export { BADGES_ATTRIBUTE };

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
  const subagentsRef = React.useRef<HTMLButtonElement | null>(null);
  const jobsRef = React.useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = React.useState<'subagents' | 'jobs' | null>(null);
  const dismiss = React.useCallback(() => { setOpen(null); }, []);
  const panelId = React.useId();

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

  React.useEffect(() => { setOpen(null); }, [active, sessionId]);
  // A panel whose badge disappeared must not keep rendering against a stale
  // anchor: the popover would have nothing to point at.
  React.useEffect(() => {
    if ((open === 'subagents' && !showSubagents) || (open === 'jobs' && !showJobs)) setOpen(null);
  }, [open, showSubagents, showJobs]);

  if (!showSubagents && !showJobs) return null;

  const rows = open === 'subagents'
    ? subagentRows(sessions, sessionId, t('badge.subagents.running'), t('badge.subagents.idle'), t('badge.subagents.completed'))
    : open === 'jobs'
      ? jobRows(sessionId === undefined ? undefined : jobs.rows[sessionId], t)
      : [];

  return <span className="dsh-mobile-badge-group" ref={rootRef}>
    {showSubagents && <Badge
      kind="subagents"
      buttonRef={subagentsRef}
      icon={<RobotGlyph />}
      count={subagents}
      label={t('badge.subagents', { count: String(subagents.total) })}
      panelId={panelId}
      open={open === 'subagents'}
      onToggle={() => { setOpen(current => current === 'subagents' ? null : 'subagents'); }}
    />}
    {showJobs && <Badge
      kind="jobs"
      buttonRef={jobsRef}
      icon={<StackGlyph />}
      count={background}
      label={t('badge.jobs', { count: String(background.total) })}
      panelId={panelId}
      open={open === 'jobs'}
      onToggle={() => { setOpen(current => current === 'jobs' ? null : 'jobs'); }}
    />}
    {open !== null && (open === 'subagents' ? showSubagents : showJobs) && <StatusPanel
      // A new kind means a new anchor: remount so the popover re-opens beside
      // the icon that is actually pressed, instead of sliding from the old one.
      key={open}
      id={panelId}
      anchorRef={open === 'subagents' ? subagentsRef : jobsRef}
      title={open === 'subagents' ? t('badge.subagents.panel') : t('badge.jobs.panel')}
      summary={t('badge.panel.summary', { count: rows.length, live: rows.filter(row => row.live).length })}
      hint={t(open === 'subagents' ? 'badge.subagents.hint' : 'badge.jobs.hint')}
      closeLabel={t('badge.close')}
      icon={open === 'subagents' ? <RobotGlyph /> : <StackGlyph />}
      empty={t('badge.empty')}
      rows={rows}
      onDismiss={dismiss}
      onPick={row => {
        if (row.sessionId !== undefined) ctx.uiWorkspace.openSession(row.sessionId);
        setOpen(null);
      }}
    />}
  </span>;
}

function Badge({ kind, buttonRef, icon, count, label, panelId, open, onToggle }: {
  kind: 'subagents' | 'jobs';
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  icon: React.ReactNode;
  count: BadgeCount;
  label: string;
  panelId: string;
  open: boolean;
  onToggle(): void;
}) {
  return <button
    type="button"
    ref={buttonRef}
    className={`dsh-mobile-badge dsh-mobile-badge-${kind}`}
    data-live={count.live ? '' : undefined}
    aria-label={label}
    aria-expanded={open}
    aria-haspopup="dialog"
    aria-controls={open ? panelId : undefined}
    title={label}
    onClick={onToggle}
  >
    {icon}
    <span className="dsh-mobile-badge-count">{formatCount(count.total)}</span>
    {count.live && <span className="dsh-mobile-badge-dot" aria-hidden="true" />}
  </button>;
}

/**
 * Subagent rows for the panel, in catalog order.
 * @param snapshot - session list snapshot.
 * @param sessionId - the owning session.
 * @param runningLabel - label for a running child.
 * @param idleLabel - label when completion has not been established.
 * @param completedLabel - label for a normally completed child.
 * @returns rows; a child with a session id is navigable.
 */
export function subagentRows(
  snapshot: SessionFacts,
  sessionId: string | undefined,
  runningLabel: string,
  idleLabel = 'idle',
  completedLabel = 'completed',
): PanelRow[] {
  if (sessionId === undefined) return [];
  const entries = snapshot.projectionsBySession?.[sessionId]?.values.subagentCatalog ?? [];
  return entries.map(entry => {
    const summary = snapshot.byId?.[entry.id];
    const live = summary?.running === true;
    // Match the host: only a normally closed local turn proves completion.
    // Running wins over a prior completed turn when a child is resumed.
    const completed = !live && entry.mode !== 'external' && summary?.projectionValues?.subagentTiming?.lastTurnCompleted === true;
    return {
      key: entry.id, label: entry.label ?? entry.id, live, sessionId: entry.id,
      meta: live ? runningLabel : completed ? completedLabel : idleLabel,
      tone: live ? 'live' : completed ? 'success' : 'neutral',
    };
  });
}

/**
 * Background-job rows for the panel.
 * @param rows - the session's roster.
 * @param t - optional locale seat for the host's known job statuses.
 * @returns rows with separate status and progress, not inert navigation buttons.
 */
export function jobRows(rows: readonly JobRow[] | undefined, t?: Translate): PanelRow[] {
  const statuses = new Set(['running', 'stopping', 'completed', 'failed', 'killed']);
  return (rows ?? []).map(row => ({
    key: row.id,
    label: row.label ?? row.id,
    meta: t !== undefined && statuses.has(row.status) ? t(`badge.job.${row.status}`) : row.status,
    detail: row.progress,
    live: row.status === 'running' || row.status === 'stopping',
    tone: row.status === 'running' || row.status === 'stopping' ? 'live'
      : row.status === 'completed' ? 'success' : row.status === 'failed' ? 'error' : 'neutral',
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
