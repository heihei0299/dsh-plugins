import assert from 'node:assert/strict';
import test from 'node:test';
import { apply, BOOTSTRAP_KEY, connectionInfo, createEntryHandler, ENTRY_PATH, inject } from '../index.js';

function fixture(options = {}) {
  const routes = new Map();
  const listeners = new Map();
  const cleanup = [];
  const messages = [];
  const logs = [];
  const calls = [];
  const port = options.port ?? 50020;
  const ctx = {
    webServer: Object.freeze({
      host: options.host ?? '192.168.1.62', port, protocol: options.protocol ?? 'http:',
      getOrigin: () => options.origin ?? `http://192.168.1.62:${port}`,
      register(route) {
        assert.equal(routes.has(route.path), false, 'route must not replace an existing owner');
        routes.set(route.path, route);
        return () => routes.delete(route.path);
      }
    }),
    webApp: Object.freeze({ getAdvertisedUrl: () => options.root ?? `http://192.168.1.62:${port}` }),
    connection: Object.freeze({
      requestRejection(req) { calls.push(['trust', req]); return options.rejection; },
      authenticatedUrl(base) {
        calls.push(['authenticate', base]);
        if (options.authError) throw new Error('fixture credential must never be logged');
        const url = new URL(base); url.searchParams.set('token', 'test-only-not-a-credential');
        return options.authUrl ?? url.href;
      }
    }),
    logger: {
      info(value) { logs.push({ level: 'info', message: value }); messages.push(value); },
      warn(value) { logs.push({ level: 'warn', message: value }); messages.push(value); }
    },
    effect(fn) { const dispose = fn(); cleanup.push(dispose); return dispose; },
    on(name, fn) { listeners.set(name, fn); cleanup.push(() => listeners.delete(name)); }
  };
  return { ctx, routes, listeners, calls, logs, messages, dispose() { while (cleanup.length) cleanup.pop()(); } };
}

function invoke(handler, method = 'GET', url = '/lan', headers = {}) {
  const response = { status: undefined, headers: {}, body: '', writeHead(status, values) { this.status = status; this.headers = values; }, end(body = '') { this.body += body; } };
  handler({ method, url, headers }, response);
  return response;
}

function assertPrivate(response) {
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['referrer-policy'], 'no-referrer');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.doesNotMatch(response.body, /test-only-not-a-credential/);
}

test('adds one exact entry and cleans up without touching the listener or Connection', () => {
  const env = fixture();
  const nativeRoute = { kind: 'prefix', path: '/api', handler() {} };
  env.routes.set('/api', nativeRoute);
  const connection = env.ctx.connection;
  apply(env.ctx);
  assert.deepEqual(inject, ['webServer', 'webApp', 'connection']);
  assert.equal(env.routes.get(ENTRY_PATH).kind, 'exact');
  assert.equal(env.routes.get('/api'), nativeRoute);
  assert.equal(env.ctx.connection, connection);
  assert.equal(env.ctx.webServer.port, 50020);
  const table = [];
  env.listeners.get('webserver/index-inject')(table);
  assert.equal(table[0].kind, 'global');
  assert.equal(table[0].name, BOOTSTRAP_KEY);
  assert.equal(table[0].value.entryUrl, 'http://192.168.1.62:50020/lan');
  assert.doesNotMatch(JSON.stringify(table), /token|cookie/i);
  assert.doesNotMatch(env.messages.join('\n'), /test-only-not-a-credential|\?token=/);
  env.dispose();
  assert.equal(env.routes.has('/lan'), false);
  assert.equal(env.routes.get('/api'), nativeRoute);
  assert.equal(env.listeners.size, 0);
  apply(env.ctx);
  env.dispose();
});

test('trust-approved 401 and existing admissions both enter the native login exchange', () => {
  for (const rejection of [401, undefined]) {
    const env = fixture({ rejection });
    const response = invoke(createEntryHandler(env.ctx));
    assert.equal(response.status, 303);
    const location = new URL(response.headers.location);
    assert.equal(location.origin, 'http://192.168.1.62:50020');
    assert.equal(location.pathname, '/');
    assert.equal(location.searchParams.get('token'), 'test-only-not-a-credential');
    assert.deepEqual(env.calls.map(call => call[0]), ['trust', 'authenticate']);
    assertPrivate(response);
  }
});

test('native 403 stops before token generation', () => {
  const env = fixture({ rejection: 403 });
  const response = invoke(createEntryHandler(env.ctx));
  assert.equal(response.status, 403);
  assert.equal(response.headers.location, undefined);
  assert.deepEqual(env.calls.map(call => call[0]), ['trust']);
  assertPrivate(response);
});

test('non-GET methods cannot mint login redirects', () => {
  for (const method of ['POST', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']) {
    const env = fixture({ rejection: 401 });
    const response = invoke(createEntryHandler(env.ctx), method);
    assert.equal(response.status, 405);
    assert.equal(response.headers.allow, 'GET');
    assert.equal(response.headers.location, undefined);
    assert.equal(env.calls.length, 0);
    assertPrivate(response);
  }
});

test('request Host, forwarded headers, tokens and next parameters never select the destination', () => {
  const env = fixture({ rejection: 401 });
  const response = invoke(createEntryHandler(env.ctx), 'GET', '/lan?next=https://attacker.invalid/&token=untrusted', {
    host: 'attacker.invalid', 'x-forwarded-host': 'attacker.invalid', 'x-forwarded-proto': 'https'
  });
  assert.equal(response.status, 303);
  assert.equal(new URL(response.headers.location).origin, 'http://192.168.1.62:50020');
  assert.equal(env.calls[1][1], 'http://192.168.1.62:50020/');
  assertPrivate(response);
});

test('configured HTTPS proxy mounts are preserved, without guessing a different port', () => {
  const env = fixture({ root: 'https://dsh.example.test/ui/', protocol: 'https:', rejection: 401 });
  const response = invoke(createEntryHandler(env.ctx));
  assert.equal(response.status, 303);
  assert.equal(new URL(response.headers.location).href, 'https://dsh.example.test/ui/?token=test-only-not-a-credential');
  assert.equal(connectionInfo(env.ctx, {}).entryUrl, 'https://dsh.example.test/ui/lan');
  assertPrivate(response);
});

test('invalid roots, changed authentication contracts and provider failures fail closed without logging credentials', () => {
  const cases = [
    { rejection: 418 }, { rejection: 401, authError: true },
    ...['file:///tmp/', 'https://user:password@example.test/', 'https://example.test/?token=old', 'https://example.test/#fragment', 'https://example.test/ui'].map(root => ({ root, rejection: 401 })),
    ...['https://attacker.invalid/?token=fixture', 'http://192.168.1.62:50020/other?token=fixture', 'http://192.168.1.62:50020/', 'http://192.168.1.62:50020/?token=', 'http://192.168.1.62:50020/?token=a&token=b', 'http://192.168.1.62:50020/?token=a&next=x', 'http://192.168.1.62:50020/?token=a#hash'].map(authUrl => ({ authUrl, rejection: 401 }))
  ];
  for (const options of cases) {
    const env = fixture(options);
    const response = invoke(createEntryHandler(env.ctx));
    assert.equal(response.status, 503);
    assert.equal(response.headers.location, undefined);
    assert.deepEqual(env.messages, []);
    assertPrivate(response);
    assert.equal(response.body, 'LAN entry unavailable.\n');
  }
});

test('bootstrap reports loopback and private candidates without claiming other interfaces are served', () => {
  const env = fixture({ host: '127.0.0.1', origin: 'http://127.0.0.1:50020', root: 'http://127.0.0.1:50020' });
  const info = connectionInfo(env.ctx, {
    lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    wifi: [{ family: 'IPv4', internal: false, address: '192.168.1.62' }, { family: 'IPv6', internal: false, address: 'fd00::1' }],
    vpn: [{ family: 'IPv4', internal: false, address: '10.2.0.2' }],
    public: [{ family: 'IPv4', internal: false, address: '203.0.113.1' }]
  });
  assert.equal(info.loopback, true);
  assert.deepEqual(info.lanAddresses, [{ name: 'wifi', address: '192.168.1.62', bound: false }, { name: 'vpn', address: '10.2.0.2', bound: false }]);
  apply(env.ctx);
  assert.equal(env.messages.some(message => message.includes('loopback-only')), true);
  env.dispose();
});

test('uses actual assigned ports, supports IPv6 and marks only the bound candidate', () => {
  const env = fixture({ port: 54321 });
  assert.equal(connectionInfo(env.ctx, { wifi: [{ family: 'IPv4', internal: false, address: '192.168.1.62' }] }).lanAddresses[0].bound, true);
  assert.equal(connectionInfo(env.ctx, {}).entryUrl, 'http://192.168.1.62:54321/lan');
  const ipv6 = fixture({ host: 'fd00::1', origin: 'http://[fd00::1]:54321', root: 'http://[fd00::1]:54321', port: 54321 });
  assert.equal(connectionInfo(ipv6.ctx, {}).entryUrl, 'http://[fd00::1]:54321/lan');
  assert.equal(connectionInfo(ipv6.ctx, {}).loopback, false);
  const loopback = fixture({ host: '::1', origin: 'http://[::1]:54321', root: 'http://[::1]:54321', port: 54321 });
  assert.equal(connectionInfo(loopback.ctx, {}).loopback, true);
});

test('missing public contracts fail before registration', () => {
  const env = fixture();
  env.ctx.connection = {};
  assert.throws(() => apply(env.ctx), /required public API connection.requestRejection/);
  assert.equal(env.routes.size, 0);
});

test('an unavailable bootstrap skips only its own row instead of failing index rendering', () => {
  const env = fixture();
  env.ctx.webApp = Object.freeze({ getAdvertisedUrl: () => 'not a url' });
  apply(env.ctx);
  const table = [];
  env.listeners.get('webserver/index-inject')(table);
  assert.deepEqual(table, []);
  assert.equal(env.routes.has('/lan'), true);
  env.dispose();
});

test('registers before the listener binds and resolves the URL on first page render', () => {
  const env = fixture();
  const webServer = env.ctx.webServer;
  env.ctx.webServer = Object.freeze({
    ...webServer,
    port: undefined,
    getOrigin: () => { throw new Error('webserver: origin read before the listener bound a port'); }
  });
  apply(env.ctx);
  assert.equal(env.routes.has('/lan'), true);
  assert.deepEqual(env.logs.map(log => log.level), ['info']);
  assert.match(env.messages.at(-1), /listener was not bound yet/);
  assert.doesNotMatch(env.messages.join('\n'), /origin read before the listener bound a port/);
  const unboundTable = [];
  env.listeners.get('webserver/index-inject')(unboundTable);
  assert.deepEqual(unboundTable, []);
  assert.equal(env.messages.length, 1, 'the startup condition is not re-logged on every render');
  env.ctx.webServer = webServer;
  const table = [];
  env.listeners.get('webserver/index-inject')(table);
  assert.equal(table[0].value.entryUrl, 'http://192.168.1.62:50020/lan');
  env.dispose();
  assert.equal(env.routes.has('/lan'), false);
});

test('the Host fallback getAdvertisedUrl failure stays listener-not-ready only while the port is unbound', () => {
  const env = fixture();
  // The installed Host advertises `publicUrl`, or `webServer.getOrigin()` as
  // the fallback; before the listener binds the port is still undefined.
  env.ctx.webServer = Object.freeze({ ...env.ctx.webServer, port: undefined });
  env.ctx.webApp = Object.freeze({
    getAdvertisedUrl() { throw new Error('webserver: origin read before the listener bound a port'); }
  });
  apply(env.ctx);
  assert.equal(env.routes.has('/lan'), true);
  assert.deepEqual(env.logs.map(log => log.level), ['info']);
  assert.match(env.messages.join('\n'), /listener was not bound yet/);
  assert.doesNotMatch(env.messages.join('\n'), /origin read before the listener bound a port/);
  env.dispose();
});

test('a bound listener whose origin has no URL form warns instead of claiming it is unbound', () => {
  const env = fixture();
  env.ctx.webServer = Object.freeze({
    ...env.ctx.webServer,
    getOrigin: () => { throw new Error('webserver: bind address "fe80::1%eth0" carries an interface zone id, which no URL can express'); }
  });
  apply(env.ctx);
  assert.equal(env.routes.has('/lan'), true);
  assert.deepEqual(env.logs.map(log => log.level), ['warn']);
  const text = env.messages.join('\n');
  assert.match(text, /listener is bound, but its origin or advertised root is unavailable/);
  assert.doesNotMatch(text, /listener was not bound yet|interface zone id|fe80|\/lan answers 503/);
  // A separately configured public root may still permit sign-in even when
  // the listener's local origin cannot be expressed as a URL.
  assert.equal(invoke(env.routes.get('/lan').handler).status, 303);
  const table = [];
  env.listeners.get('webserver/index-inject')(table);
  assert.deepEqual(table, []);
  assert.equal(env.messages.length, 1, 'the bound-origin warning is emitted once');
  env.dispose();
});

test('a throwing getAdvertisedUrl on a bound listener is not classified as unbound', () => {
  const env = fixture();
  env.ctx.webApp = Object.freeze({
    getAdvertisedUrl() { throw new Error('provider failed for https://user:password@example.test/?token=fixture'); }
  });
  apply(env.ctx);
  assert.equal(env.routes.has('/lan'), true);
  assert.deepEqual(env.logs.map(log => log.level), ['warn']);
  const text = env.messages.join('\n');
  assert.match(text, /listener is bound, but its origin or advertised root is unavailable/);
  assert.doesNotMatch(text, /listener was not bound yet|password|example\.test|token=fixture/);
  env.dispose();
});

test('an invalid advertised root is diagnosed as invalid, not as an unbound listener, without echoing it', () => {
  for (const root of ['file:///tmp/', 'https://user:password@example.test/', 'https://example.test/?token=old', 'https://example.test/#fragment', 'https://example.test/ui', 'not a url']) {
    const env = fixture({ root });
    apply(env.ctx);
    assert.equal(env.routes.has('/lan'), true);
    const text = env.messages.join('\n');
    assert.deepEqual(env.logs.map(log => log.level), ['warn']);
    assert.match(text, /advertised Web root is invalid/);
    assert.doesNotMatch(text, /listener was not bound yet/);
    for (const leaked of ['file://', 'example.test', 'password', 'token=old', '/tmp/']) {
      assert.equal(text.includes(leaked), false, `the diagnostic must not echo ${leaked}`);
    }
    const response = invoke(createEntryHandler(env.ctx));
    assert.equal(response.status, 503);
    assert.equal(response.headers.location, undefined);
    assert.equal(env.messages.length, 1, 'the startup diagnostic is emitted once');
    const table = [];
    env.listeners.get('webserver/index-inject')(table);
    assert.deepEqual(table, []);
    assert.equal(env.messages.length, 1, 'a repeated page-render failure is not re-logged');
    assertPrivate(response);
    env.dispose();
  }
});

test('an invalid advertised root is not masked by the normal unbound-listener startup order', () => {
  const env = fixture({ root: 'https://user:password@example.test/' });
  env.ctx.webServer = Object.freeze({
    ...env.ctx.webServer,
    port: undefined,
    getOrigin: () => { throw new Error('webserver: origin read before the listener bound a port'); }
  });
  apply(env.ctx);
  assert.equal(env.routes.has('/lan'), true);
  assert.deepEqual(env.logs.map(log => log.level), ['warn']);
  assert.match(env.messages.join('\n'), /advertised Web root is invalid/);
  assert.doesNotMatch(env.messages.join('\n'), /listener was not bound yet|password|example\.test|origin read before/);
  env.dispose();
});

test('connectionInfo names only the fixed, classified cause', () => {
  const invalid = fixture({ root: 'https://example.test/ui' });
  assert.throws(() => connectionInfo(invalid.ctx, {}), { message: 'dsh-lan-connect: the advertised Web root must be a credential-free HTTP(S) directory URL' });
  const unboundPort = fixture();
  unboundPort.ctx.webServer = Object.freeze({ ...unboundPort.ctx.webServer, port: undefined });
  assert.throws(() => connectionInfo(unboundPort.ctx, {}), { message: 'dsh-lan-connect: Web listener is not ready' });
  const boundOrigin = fixture();
  boundOrigin.ctx.webServer = Object.freeze({
    ...boundOrigin.ctx.webServer,
    getOrigin: () => { throw new Error('webserver: origin read before the listener bound a port'); }
  });
  assert.throws(() => connectionInfo(boundOrigin.ctx, {}), { message: 'dsh-lan-connect: the Web listener is bound, but its origin or advertised Web root is unavailable' });
  const boundAdvertised = fixture();
  boundAdvertised.ctx.webApp = Object.freeze({ getAdvertisedUrl() { throw new Error('provider secret'); } });
  assert.throws(() => connectionInfo(boundAdvertised.ctx, {}), { message: 'dsh-lan-connect: the Web listener is bound, but its origin or advertised Web root is unavailable' });
});
