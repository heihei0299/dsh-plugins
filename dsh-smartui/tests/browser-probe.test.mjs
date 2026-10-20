import { test } from 'node:test';
import assert from 'node:assert/strict';
import { debugBase, dshTargets, pageSocket } from '../scripts/browser-probe.mjs';

test('debug addresses accept the Chrome HTTP discovery paths without credentials', () => {
  assert.equal(debugBase('http://127.0.0.1:9222').href, 'http://127.0.0.1:9222/');
  assert.equal(debugBase('http://127.0.0.1:9222/json/version').href, 'http://127.0.0.1:9222/');
  assert.equal(debugBase('https://debug.example:9443/json/list').href, 'https://debug.example:9443/');
});
test('debug addresses reject credentials, unrelated schemes and extra paths', () => {
  for (const value of ['file:///tmp/profile', 'ws://127.0.0.1:9222', 'http://user:password@localhost:9222', 'http://localhost:9222?token=example', 'http://localhost:9222/#fragment', 'http://localhost:9222/private']) {
    assert.throws(() => debugBase(value));
  }
});
test('only DSH page targets are eligible; unrelated browser tabs are not returned', () => {
  const matching = { id: 'dsh', type: 'page', url: 'http://arch.local:50020/session/example', webSocketDebuggerUrl: 'ws://localhost:9222/devtools/page/dsh' };
  const targets = [matching,
    { ...matching, id: 'unrelated', url: 'https://example.org/' },
    { ...matching, id: 'worker', type: 'service_worker' },
    { ...matching, id: 'invalid', url: 'not a url' },
    { ...matching, id: 'noSocket', webSocketDebuggerUrl: undefined },
  ];
  assert.deepEqual(dshTargets(targets, 'http://arch.local:50020'), [matching]);
  assert.throws(() => dshTargets({}));
});
test('the probe matches the local origin by default and ignores other origins', () => {
  const local = { id: 'local', type: 'page', url: 'http://127.0.0.1:50020/session/example', webSocketDebuggerUrl: 'ws://localhost:9222/devtools/page/local' };
  const remote = { ...local, id: 'remote', url: 'http://arch.local:50020/session/example' };
  assert.deepEqual(dshTargets([remote, local]), [local]);
  assert.deepEqual(dshTargets([remote, local], 'http://arch.local:50020'), [remote]);
});
test('page sockets use the supplied host instead of an advertised localhost address', () => {
  const base = debugBase('http://192.0.2.10:9222');
  assert.equal(pageSocket(base, { webSocketDebuggerUrl: 'ws://localhost:9222/devtools/page/abc' }).href, 'ws://192.0.2.10:9222/devtools/page/abc');
  assert.equal(pageSocket(debugBase('https://debug.example:9443'), { webSocketDebuggerUrl: 'ws://localhost:9222/devtools/page/abc' }).href, 'wss://debug.example:9443/devtools/page/abc');
});
test('socket discovery cannot redirect the probe to a different service path', () => {
  for (const value of ['https://example.org/devtools/page/a', 'ws://localhost:9222/private', 'ws://localhost:9222/devtools/page/../../private']) {
    assert.throws(() => pageSocket(debugBase('http://127.0.0.1:9222'), { webSocketDebuggerUrl: value }));
  }
});
