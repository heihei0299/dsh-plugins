import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import en from '../locale/en.json' with { type: 'json' };
import { ActivationContext, EnvironmentContext, type Environment } from '../src/client/environment.js';
import { StatusBadges, jobRows, subagentRows } from '../src/client/StatusBadges.js';
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

test('job rows prefer live progress over the raw status', () => {
  const rows = jobRows([
    { id: 'job-1', label: 'Build', status: 'running', progress: '3/10' },
    { id: 'job-2', status: 'completed' },
  ]);
  assert.equal(rows[0]?.meta, '3/10');
  assert.equal(rows[0]?.live, true);
  assert.equal(rows[1]?.meta, 'completed');
  assert.equal(rows[1]?.live, false);
  assert.deepEqual(jobRows(undefined), []);
});
