import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { debugBase, dshTargets, parseViewport, pageSocket } from '../scripts/browser-probe.mjs';
import {
  PROBE_ANCHORS, PROBE_EXIT_FAIL, PROBE_EXIT_PASS, PROBE_LANDMARKS, probeExitCode, probeVerdict,
} from '../scripts/probe-landmarks.mjs';

test('only a bare HTTP(S) debugging address is accepted', () => {
  assert.equal(debugBase('http://127.0.0.1:9222').pathname, '/');
  assert.equal(debugBase('http://127.0.0.1:9222/json/version').pathname, '/');
  assert.throws(() => debugBase('http://user:pass@127.0.0.1:9222'), /credentials/);
  assert.throws(() => debugBase('http://127.0.0.1:9222/?token=x'), /credentials/);
  assert.throws(() => debugBase('file:///tmp/x'), /HTTP\(S\)/);
  assert.throws(() => debugBase('http://127.0.0.1:9222/other'), /remote-debugging/);
});

test('only the requested origin and real page targets are probed', () => {
  const targets = [
    { type: 'page', url: 'http://127.0.0.1:50020/', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/A' },
    { type: 'page', url: 'http://127.0.0.1:3080/', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/B' },
    { type: 'browser_ui', url: 'http://127.0.0.1:50020/', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/C' },
    { type: 'page', url: 'chrome://newtab', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/D' },
    { type: 'page', url: 'http://127.0.0.1:50020/', webSocketDebuggerUrl: undefined },
  ];
  assert.deepEqual(dshTargets(targets, 'http://127.0.0.1:50020').map(target => target.webSocketDebuggerUrl), [
    'ws://127.0.0.1:9222/devtools/page/A',
  ]);
  assert.throws(() => dshTargets(null), /did not return an array/);
});

test('the page socket keeps the caller address but the advertised page path', () => {
  const socket = pageSocket(new URL('http://10.0.0.5:9222/'), { webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/ABC' });
  assert.equal(socket.protocol, 'ws:');
  assert.equal(socket.hostname, '10.0.0.5');
  assert.equal(socket.pathname, '/devtools/page/ABC');
  const secure = pageSocket(new URL('https://10.0.0.5:9223/'), { webSocketDebuggerUrl: 'ws://localhost:9222/devtools/page/ABC' });
  assert.equal(secure.protocol, 'wss:');
  assert.throws(() => pageSocket(new URL('http://127.0.0.1:9222/'), { webSocketDebuggerUrl: 'ws://127.0.0.1:9222/json/list' }), /page debugging/);
});

test('viewport parsing is strict and refuses unusable sizes', () => {
  assert.deepEqual(parseViewport('390x844'), { width: 390, height: 844 });
  assert.deepEqual(parseViewport('1440x900'), { width: 1440, height: 900 });
  assert.throws(() => parseViewport('390'), /WIDTHxHEIGHT/);
  assert.throws(() => parseViewport('390x'), /WIDTHxHEIGHT/);
  assert.throws(() => parseViewport('10x10'), /smaller than/);
  assert.throws(() => parseViewport(undefined), /WIDTHxHEIGHT/);
});

/** A shell page contains its three anchors and column wrappers, but no conditional content. */
function shellPage() {
  const shell = new Set(['sidebar', 'main', 'rightbar']);
  return {
    rootAttribute: 'drawer',
    styleTags: 1,
    crashes: 0,
    landmarks: Object.fromEntries(PROBE_LANDMARKS.map(entry => [entry.key, entry.when === 'always' || shell.has(entry.when) ? 1 : 0])),
    anchors: Object.fromEntries(Object.keys(PROBE_ANCHORS).map(key => [key, shell.has(key) ? 1 : 0])),
  };
}

/** A conversation page: the session header anchor makes conversation DOM applicable. */
function conversationPage() {
  const page = shellPage();
  page.anchors = { ...page.anchors, conversation: 1, composer: 1 };
  for (const entry of PROBE_LANDMARKS) {
    if (entry.when === 'conversation' || entry.when === 'composer') page.landmarks[entry.key] = 1;
  }
  return page;
}

const reportOf = page => ({ connected: true, browser: 'Chrome/1', targetId: 'A', page, readOnly: true });
const codes = verdict => verdict.failures.map(failure => failure.code);

test('the landmark selectors are unique, conditional on known anchors, and never localized', () => {
  const keys = new Set();
  const names = new Set();
  for (const entry of PROBE_LANDMARKS) {
    assert.match(entry.key, /^[a-z0-9-]+$/);
    assert.ok(!keys.has(entry.key), `duplicate probe key ${entry.key}`);
    keys.add(entry.key);
    assert.ok(!names.has(entry.name), `duplicate probe name ${entry.name}`);
    names.add(entry.name);
    assert.ok(entry.when === 'always' || entry.when === null || Object.hasOwn(PROBE_ANCHORS, entry.when), `unknown condition ${entry.when}`);
    assert.doesNotMatch(entry.selector, /aria-label/, 'live checks must not depend on localized copy');
  }
  for (const [key, selector] of Object.entries(PROBE_ANCHORS)) {
    assert.ok(key.length > 0);
    assert.doesNotMatch(selector, /aria-label/);
  }
});

test('the gate accepts a shell page where conditional DOM legitimately does not exist', () => {
  const verdict = probeVerdict(reportOf(shellPage()));
  assert.deepEqual(codes(verdict), []);
  assert.equal(verdict.ok, true);
});

test('the gate detects a moved shell column even if its anchor remains', () => {
  const page = shellPage();
  page.landmarks['sidebar-column'] = 0;
  assert.ok(codes(probeVerdict(reportOf(page))).includes('missing:sidebar-column'));
});

test('the gate requires conversation landmarks only once the session header exists', () => {
  assert.equal(probeVerdict(reportOf(conversationPage())).ok, true);
  const missing = conversationPage();
  missing.landmarks['conversation-scroll'] = 0;
  assert.deepEqual(codes(probeVerdict(reportOf(missing))), ['missing:conversation-scroll']);
  // Composer internals are gated by the card, never required on their own.
  const noComposer = shellPage();
  noComposer.anchors = { ...noComposer.anchors, conversation: 1 };
  for (const entry of PROBE_LANDMARKS) if (entry.when === 'conversation') noComposer.landmarks[entry.key] = 1;
  assert.equal(probeVerdict(reportOf(noComposer)).ok, true);
  const noInput = conversationPage();
  noInput.landmarks['composer-input'] = 0;
  assert.deepEqual(codes(probeVerdict(reportOf(noInput))), ['missing:composer-input']);
});

test('the gate checks settings, tabs and tables only when their page state is present', () => {
  const settings = shellPage();
  settings.anchors = { ...settings.anchors, settings: 1 };
  for (const entry of PROBE_LANDMARKS) if (entry.when === 'settings') settings.landmarks[entry.key] = 1;
  assert.equal(probeVerdict(reportOf(settings)).ok, true, 'settings list head stays optional');
  settings.landmarks['settings-nav'] = 0;
  assert.deepEqual(codes(probeVerdict(reportOf(settings))), ['missing:settings-nav']);

  const tabs = shellPage();
  tabs.anchors = { ...tabs.anchors, tabs: 1 };
  assert.deepEqual(codes(probeVerdict(reportOf(tabs))), ['missing:view-tabs']);

  const table = shellPage();
  table.anchors = { ...table.anchors, table: 1 };
  assert.deepEqual(codes(probeVerdict(reportOf(table))), ['missing:table-wrapper']);
});

test('the gate rejects an inactive plugin, a missing stylesheet and slot crashes', () => {
  const inactive = shellPage();
  inactive.rootAttribute = null;
  assert.deepEqual(codes(probeVerdict(reportOf(inactive))), ['inactive']);
  const unstyled = shellPage();
  unstyled.styleTags = 0;
  assert.deepEqual(codes(probeVerdict(reportOf(unstyled))), ['no-stylesheet']);
  const crashed = shellPage();
  crashed.crashes = 1;
  assert.deepEqual(codes(probeVerdict(reportOf(crashed))), ['slot-crash']);
});

test('the gate reports no target separately, and only the explicit gate fails on it', () => {
  const report = { connected: true, browser: 'Chrome/1', needsTarget: true, matchingDshTabs: [], nextStep: 'open the DSH tab' };
  assert.deepEqual(codes(probeVerdict(report)), ['no-target']);
  // Report mode remains exit 0; the acceptance gate is the only non-zero path.
  assert.equal(probeExitCode(report), PROBE_EXIT_PASS);
  assert.equal(probeExitCode(report, true), PROBE_EXIT_FAIL);
  assert.equal(probeExitCode(reportOf(shellPage()), true), PROBE_EXIT_PASS);
  assert.equal(probeExitCode(null), PROBE_EXIT_PASS);
  assert.equal(probeExitCode(null, true), PROBE_EXIT_FAIL);
  assert.deepEqual(codes(probeVerdict(null)), ['no-report']);
  assert.deepEqual(codes(probeVerdict({ connected: true })), ['no-page']);
});

test('a renamed unconditional shell anchor fails instead of silently skipping its group', () => {
  const page = shellPage();
  page.landmarks['sidebar-anchor'] = 0;
  assert.ok(codes(probeVerdict(reportOf(page))).includes('missing:sidebar-anchor'));
  const main = shellPage();
  main.landmarks['main-anchor'] = 0;
  assert.ok(codes(probeVerdict(reportOf(main))).includes('missing:main-anchor'));
  const rightbar = shellPage();
  rightbar.landmarks['rightbar-anchor'] = 0;
  assert.ok(codes(probeVerdict(reportOf(rightbar))).includes('missing:rightbar-anchor'));
});

test('CLI rejects an incomplete expectation before contacting Chrome', () => {
  const script = fileURLToPath(new URL('../scripts/browser-probe.mjs', import.meta.url));
  for (const args of [
    ['--verify', '--expect'],
    ['--verify', '--expect', '--touch'],
    ['--verify', '--expect', ','],
    ['--expect', 'conversation'],
  ]) {
    const result = spawnSync(process.execPath, [script, 'http://127.0.0.1:9', ...args], { encoding: 'utf8', timeout: 5_000 });
    assert.equal(result.status, 2, args.join(' '));
    assert.match(result.stderr, /--expect requires --verify and at least one page state/);
  }
});

test('--expect makes a missing conditional anchor fail instead of being read as another page state', () => {
  assert.deepEqual(codes(probeVerdict(reportOf(shellPage()), { expect: ['conversation'] })), ['expected:conversation']);
  assert.equal(probeVerdict(reportOf(conversationPage()), { expect: ['conversation'] }).ok, true);

  const settings = shellPage();
  settings.anchors = { ...settings.anchors, settings: 1 };
  for (const entry of PROBE_LANDMARKS) if (entry.when === 'settings') settings.landmarks[entry.key] = 1;
  assert.equal(probeVerdict(reportOf(settings), { expect: ['settings'] }).ok, true);
  assert.deepEqual(codes(probeVerdict(reportOf(shellPage()), { expect: ['settings'] })), ['expected:settings']);
  assert.deepEqual(codes(probeVerdict(reportOf(shellPage()), { expect: ['nope'] })), ['unknown-expectation:nope']);
  assert.equal(probeExitCode(reportOf(shellPage()), true, ['conversation']), PROBE_EXIT_FAIL);
  assert.equal(probeExitCode(reportOf(conversationPage()), true, ['conversation']), PROBE_EXIT_PASS);
});
