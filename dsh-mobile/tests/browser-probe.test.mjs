import test from 'node:test';
import assert from 'node:assert/strict';
import { debugBase, dshTargets, parseViewport, pageSocket } from '../scripts/browser-probe.mjs';

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
