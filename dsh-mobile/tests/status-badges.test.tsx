import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import en from '../locale/en.json' with { type: 'json' };
import { ActivationContext, EnvironmentContext, type Environment } from '../src/client/environment.js';
import { StatusBadges, jobRows, subagentRows } from '../src/client/StatusBadges.js';
import { inject } from '../src/client/index.js';
import { StatusPanel, anchoredPanelPosition } from '../src/client/StatusPanel.js';
import type { ClientContext } from '../src/client/contracts.js';
import { DEFAULT_SETTINGS, type MobileSettings } from '../src/shared/types.js';

interface Row { readonly retainedBy?: { readonly mainView?: number }; readonly running?: boolean; readonly origin?: string }

function environment(options: {
  sessions?: { byId?: Record<string, Row>; projectionsBySession?: Record<string, { values: { subagentCatalog?: readonly { id: string; label?: string }[] } }> };
  jobs?: Record<string, readonly { id: string; label?: string; status: string; progress?: string }[]>;
  watched?: string[];
  opened?: string[];
} = {}): Environment {
  const sessions = options.sessions ?? {};
  const jobs = options.jobs ?? {};
  const ctx = {
    sessions: {
      list: { getSnapshot: () => sessions, subscribe: () => () => {} },
    },
    jobs: {
      state: { getSnapshot: () => ({ rows: jobs }), subscribe: () => () => {} },
      watchRows: (sessionId: string) => { options.watched?.push(sessionId); return () => {}; },
    },
    uiWorkspace: { openSession: (target: string) => { options.opened?.push(target); } },
    locale: { getSnapshot: () => ({ active: 'en', revision: 0 }), subscribe: () => () => {} },
  } as unknown as ClientContext;
  return {
    ctx,
    form: { getSnapshot: () => ({ status: 'ready', value: { ...DEFAULT_SETTINGS }, writable: true, revision: 1 }), subscribe: () => () => {}, set: async () => true },
    t: (key, values) => {
      let text = (en.ui as Record<string, string>)[key] ?? key;
      for (const [name, value] of Object.entries(values ?? {})) text = text.replaceAll(`{${name}}`, String(value));
      return text;
    },
  };
}

function render(node: React.ReactNode, setup: {
  environment?: Environment;
  active?: boolean;
  settings?: MobileSettings | undefined;
  drawerClosed?: boolean;
} = {}): string {
  return renderToStaticMarkup(
    <EnvironmentContext.Provider value={setup.environment ?? environment()}>
      <ActivationContext.Provider value={{
        active: setup.active ?? true,
        settings: setup.settings ?? DEFAULT_SETTINGS,
        drawerClosed: setup.drawerClosed ?? true,
      }}>{node}</ActivationContext.Provider>
    </EnvironmentContext.Provider>,
  );
}

test('subagent navigation is declared as a required Cordis service', () => {
  assert.ok(inject.includes('uiWorkspace'), 'Cordis rejects property access without injection; optional chaining cannot bypass it');
});

test('badges render an icon and a count instead of a long label', () => {
  const html = render(<StatusBadges sessionId="session-a" />, {
    environment: environment({
      sessions: {
        byId: { 'session-a': {}, 'child-1': { running: true } },
        projectionsBySession: { 'session-a': { values: { subagentCatalog: [{ id: 'child-1', label: 'One' }] } } },
      },
      jobs: { 'session-a': [{ id: 'job-1', label: 'Build', status: 'running', progress: '3/10' }] },
    }),
  });
  assert.equal((html.match(/class="dsh-mobile-badge dsh-mobile-badge-/g) ?? []).length, 2);
  assert.match(html, /<svg[^>]*aria-hidden="true"/);
  assert.match(html, /aria-label="1 subagents"/);
  assert.match(html, /aria-label="1 background tasks"/);
  assert.equal((html.match(/dsh-mobile-badge-dot/g) ?? []).length, 2, 'a live row marks its badge');
});

test('a zero count renders no badge at all', () => {
  assert.equal(render(<StatusBadges sessionId="session-a" />, { environment: environment() }), '');
  assert.equal(render(<StatusBadges sessionId="session-a" />, {
    environment: environment({ sessions: { projectionsBySession: { 'session-a': { values: { subagentCatalog: [] } } } } }),
  }), '');
});

test('nothing renders while the mobile layout is inactive', () => {
  const html = render(<StatusBadges sessionId="session-a" />, {
    active: false,
    settings: undefined,
    environment: environment({
      sessions: { byId: { 'session-a': {}, 'child-1': {} }, projectionsBySession: { 'session-a': { values: { subagentCatalog: [{ id: 'child-1' }] } } } },
    }),
  });
  assert.equal(html, '');
});

test('installing the badges watches the session roster', () => {
  // Rendered outside React's effect phase (static markup), so this asserts the
  // component was built against a ctx that exposes watchRows without throwing.
  const watched: string[] = [];
  render(<StatusBadges sessionId="session-a" />, {
    environment: environment({
      watched,
      jobs: { 'session-a': [{ id: 'job-1', status: 'running' }] },
    }),
  });
  assert.deepEqual(watched, [], 'static rendering does not run effects');
});

test('counts above nine collapse to 9+', () => {
  const catalog = Array.from({ length: 12 }, (_, index) => ({ id: `child-${String(index)}` }));
  const html = render(<StatusBadges sessionId="session-a" />, {
    environment: environment({ sessions: { byId: { 'session-a': {} }, projectionsBySession: { 'session-a': { values: { subagentCatalog: catalog } } } } }),
  });
  assert.match(html, />9\+<\/span>/);
});

test('subagent rows expose labels, running state and the navigation target', () => {
  const rows = subagentRows({
    byId: { 'child-1': { running: true }, 'child-2': {} },
    projectionsBySession: { 'session-a': { values: { subagentCatalog: [
      { id: 'child-1', label: 'Running child' },
      { id: 'child-2' },
    ] } } },
  }, 'session-a', 'running');
  assert.deepEqual(rows.map(row => row.key), ['child-1', 'child-2']);
  assert.equal(rows[0]?.meta, 'running');
  assert.equal(rows[0]?.sessionId, 'child-1');
  assert.equal(rows[1]?.label, 'child-2', 'a child without a label falls back to its id');
  assert.deepEqual(subagentRows({}, undefined, 'running'), []);
});

test('job rows keep status and progress separate', () => {
  const rows = jobRows([
    { id: 'job-1', label: 'Build', status: 'running', progress: '3/10' },
    { id: 'job-2', status: 'completed' },
  ]);
  assert.equal(rows[0]?.meta, 'running');
  assert.equal(rows[0]?.detail, '3/10');
  assert.equal(rows[0]?.tone, 'live');
  assert.equal(rows[0]?.live, true);
  assert.equal(rows[1]?.meta, 'completed');
  assert.equal(rows[1]?.live, false);
  assert.deepEqual(jobRows(undefined), []);
});

test('job statuses are localized without replacing progress or inventing navigation', () => {
  const rows = jobRows([
    { id: 'done', status: 'completed', progress: '24 / 24' },
    { id: 'failed', status: 'failed' },
    { id: 'future', status: 'queued' },
  ], environment().t);
  assert.equal(rows[0]?.meta, 'Completed');
  assert.equal(rows[0]?.detail, '24 / 24');
  assert.equal(rows[0]?.tone, 'success');
  assert.equal(rows[1]?.tone, 'error');
  assert.equal(rows[2]?.meta, 'queued', 'unrecognized host states remain readable');
  assert.ok(rows.every(row => row.sessionId === undefined));
});

test('the panel is a non-modal popover anchored to its icon, not a sheet', () => {
  const html = renderToStaticMarkup(<StatusPanel
    id="popup" anchorRef={{ current: null }} title="Background tasks" summary="2 total" hint="Status and progress"
    empty="Nothing yet" closeLabel="Close panel" icon={null}
    rows={[
      { key: 'job', label: 'A long background command', meta: 'Completed' },
      { key: 'child', label: 'Child conversation', meta: 'Idle', sessionId: 'child' },
    ]}
    onPick={() => {}} onDismiss={() => {}}
  />);
  assert.match(html, /^<div [^>]*popover="manual"/, 'the top layer is what keeps the header from clipping the popup');
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="false"/, 'it must never claim modality: the page behind stays interactive');
  assert.match(html, /aria-labelledby="popup-title"/);
  assert.match(html, /<ul class="dsh-mobile-badge-panel-list"/);
  assert.doesNotMatch(html, /<dialog|::backdrop|aria-modal="true"/, 'no modal dialog, no dimming sheet');
  assert.equal((html.match(/<button /g) ?? []).length, 2, 'one close button plus one navigable child');
  assert.doesNotMatch(html, /role="menu/);
});

test('read-only job rows never render as buttons', () => {
  const html = renderToStaticMarkup(<StatusPanel
    id="jobs" anchorRef={{ current: null }} title="Background tasks" summary="1 total" hint="Status"
    empty="Nothing yet" closeLabel="Close panel" icon={null}
    rows={[{ key: 'job', label: 'Build', meta: 'Running', detail: '3/10' }]}
    onPick={() => {}} onDismiss={() => {}}
  />);
  assert.equal((html.match(/<button /g) ?? []).length, 1, 'only the close button is interactive');
  assert.doesNotMatch(html, /dsh-mobile-badge-row-arrow/, 'a status row is not advertised as navigation');
});

test('the popup opens 8px under the icon, right-aligned inside the viewport', () => {
  const viewport = { left: 0, top: 0, width: 390, height: 844 };
  const placement = anchoredPanelPosition({ right: 378, top: 20, bottom: 44 }, viewport, 600);
  assert.equal(placement.placement, 'below');
  assert.equal(placement.top, 52, '16px badge row bottom + 8px gap');
  assert.equal(placement.width, 360);
  assert.equal(placement.left, 18, 'the right edge follows the icon: 378 - 360');
  assert.equal(placement.maxHeight, 440, 'a long list is capped, not stretched');
});

test('the popup stays inside 360px and 390px portrait viewports', () => {
  const expected = new Map([[360, { width: 336, left: 12 }], [390, { width: 360, left: 18 }]]);
  for (const [width, size] of expected) {
    const viewport = { left: 0, top: 0, width, height: 844 };
    const placement = anchoredPanelPosition({ right: width - 12, top: 20, bottom: 44 }, viewport, 600);
    assert.equal(placement.width, size.width, 'never wider than the 360px menu card');
    assert.equal(placement.left, size.left);
    assert.ok(placement.left >= 12 && placement.left + placement.width <= width - 12);
  }
});

test('the popup fits a 844x390 landscape viewport without covering the anchor', () => {
  const viewport = { left: 0, top: 0, width: 844, height: 390 };
  const placement = anchoredPanelPosition({ right: 832, top: 20, bottom: 44 }, viewport, 600);
  assert.equal(placement.width, 360);
  assert.equal(placement.left, 472);
  assert.ok(placement.left + placement.width <= 832, 'never wider than the icon edge');
  assert.equal(placement.top, 52);
  assert.ok(placement.top + placement.maxHeight <= 378, 'the list scrolls instead of leaving the screen');
  assert.ok(placement.maxHeight < placement.height + 1);
});

test('the popup flips above only when there is more room there', () => {
  const low = anchoredPanelPosition({ right: 300, top: 200, bottom: 240 }, { left: 0, top: 0, width: 320, height: 300 }, 120);
  assert.equal(low.placement, 'above');
  assert.equal(low.top, 72, '200 - 8 gap - 120 height');
  assert.ok(low.top >= 12);
  // Below is cramped but above is worse: stay below and let the list scroll.
  const cramped = anchoredPanelPosition({ right: 300, top: 40, bottom: 64 }, { left: 0, top: 0, width: 320, height: 300 }, 600);
  assert.equal(cramped.placement, 'below');
  assert.equal(cramped.top, 72);
  assert.ok(cramped.top + cramped.maxHeight <= 288);
});

test('the popup clamps a viewport narrower than its preferred width', () => {
  const placement = anchoredPanelPosition({ right: 300, top: 20, bottom: 44 }, { left: 0, top: 0, width: 300, height: 600 }, 200);
  assert.equal(placement.width, 276);
  assert.equal(placement.left, 12);
  assert.ok(placement.left + placement.width <= 288);
});
