import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import plugin from '../index.js';

// Explicit opt-in to the installed runtime, not a user's profile or credentials.
const runtimeRoot = process.env.DSH_TEST_RUNTIME_ROOT;

class ResponseSink extends Writable {
  chunks = [];
  status = undefined;
  headers = {};
  _write(chunk, _encoding, callback) { this.chunks.push(Buffer.from(chunk)); callback(); }
  writeHead(status, headers = {}) { this.status = status; this.headers = headers; return this; }
  get body() { return Buffer.concat(this.chunks).toString('utf8'); }
}

function request(url, headers, body, method = 'GET') {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(body)]);
  Object.assign(req, { url, method, headers });
  return req;
}

/**
 * Read the underlying service value.
 *
 * Cordis hands out a fresh traceable proxy per access, so `ctx.connection`
 * never compares reference-equal even when nothing replaced the provider. The
 * raw implementation value is what proves the plugin added a route without
 * swapping Connection or the listener.
 * @param ctx - root context.
 * @param name - provided service name.
 * @returns the service value stored by its providing fiber.
 */
function rawService(ctx, name) {
  return ctx.reflect._getImpl(name)?.value;
}

test('installed native authentication, RPC, binary intake and socket admission survive additive LAN entry lifecycle', { skip: !runtimeRoot }, async t => {
  const requireRuntime = createRequire(join(runtimeRoot, 'package.json'));
  const { Context } = await import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/cordis')).href);
  const native = await import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/dsh-client-connection')).href);
  const ctx = new Context();
  t.after(async () => { await ctx.fiber.dispose(); });
  const records = new Map();
  ctx.provide('credentials', {
    async modifyRecord(key, update) {
      const next = await update(records.get(key));
      if (next !== undefined) records.set(key, next);
      return records.get(key);
    }
  });
  const routes = new Map();
  const authority = '192.168.1.62:50020';
  const root = `http://${authority}`;
  const webServer = Object.freeze({
    host: '192.168.1.62', port: 50020, protocol: 'http:',
    getOrigin: () => root,
    register(route) {
      assert.equal(routes.has(route.path), false);
      routes.set(route.path, route);
      return () => routes.delete(route.path);
    }
  });
  ctx.provide('webServer', webServer);
  ctx.provide('webApp', { getAdvertisedUrl: () => root });
  const connectionFiber = ctx.plugin(native, {});
  await connectionFiber.await();
  const connection = rawService(ctx, 'connection');
  const nativeApi = routes.get('/api');
  assert.ok(nativeApi);
  const headers = { host: authority };
  assert.equal(connection.admit({ headers }).rejection, 401);
  assert.equal(connection.admitConnection({ headers }).rejection, 401);
  const initial = new ResponseSink();
  assert.equal(connection.authorizeIndex(request('/', headers), initial), false);
  assert.equal(initial.status, 401);

  let lan = ctx.plugin(plugin);
  await lan.await();
  assert.equal(rawService(ctx, 'connection'), connection);
  assert.equal(rawService(ctx, 'webServer'), webServer);
  assert.equal(routes.get('/api'), nativeApi);

  const forbidden = new ResponseSink();
  routes.get('/lan').handler(request('/lan', { host: 'attacker.invalid' }), forbidden);
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.headers.location, undefined);
  const crossOrigin = new ResponseSink();
  routes.get('/lan').handler(request('/lan', { ...headers, origin: 'http://attacker.invalid' }), crossOrigin);
  assert.equal(crossOrigin.status, 403);

  const entry = new ResponseSink();
  routes.get('/lan').handler(request('/lan?next=https://attacker.invalid', headers), entry);
  assert.equal(entry.status, 303);
  assert.equal(entry.headers['set-cookie'], undefined, 'only native authentication may mint the cookie');
  const loginUrl = new URL(entry.headers.location);
  assert.equal(loginUrl.origin, root);
  assert.equal(loginUrl.searchParams.getAll('token').length, 1);
  const login = new ResponseSink();
  assert.equal(connection.authorizeIndex(request(loginUrl.pathname + loginUrl.search, headers), login), false);
  assert.equal(login.status, 303);
  assert.equal(login.headers.location, './');
  assert.match(login.headers['set-cookie'], /HttpOnly/);
  assert.match(login.headers['set-cookie'], /SameSite=Strict/);
  const cookie = login.headers['set-cookie'].split(';', 1)[0];
  const admittedHeaders = { ...headers, cookie };
  assert.equal(connection.authorizeIndex(request('/', admittedHeaders), new ResponseSink()), true);
  const admission = connection.admit({ headers: admittedHeaders });
  assert.equal(admission.peer.principal.kind, 'owner');
  assert.equal(admission.peer.interactions, 'answer');
  const socket = connection.admitConnection({ headers: admittedHeaders });
  assert.equal(socket.peer, admission.peer);
  await socket.release();
  assert.equal(connection.admit({ headers: admittedHeaders }).peer, admission.peer);

  await ctx.effect(() => connection.rpc.intercept('/api', endpoint => endpoint === 'fixture/echo', async (_endpoint, payload, _signal, peer) => {
    assert.equal(peer.principal.kind, 'owner');
    return { ok: true, value: payload };
  }));
  const api = new ResponseSink();
  await nativeApi.handler(request('/api/fixture/echo', { ...admittedHeaders, 'content-type': 'application/json' }, JSON.stringify({ type: 'client-request', rpcId: 'lan-test', method: 'fixture/echo', payload: { message: 'remote device' } }), 'POST'), api);
  assert.equal(api.status, 200);
  assert.deepEqual(JSON.parse(api.body).result, { ok: true, value: { message: 'remote device' } });
  const noCookie = new ResponseSink();
  await nativeApi.handler(request('/api/fixture/echo', headers, undefined, 'POST'), noCookie);
  assert.equal(noCookie.status, 401);

  await ctx.effect(() => connection.fetch.register({
    path: '/api/fixture/upload', methods: ['POST'], requestBody: 'streaming',
    fetch: async req => new Response(JSON.stringify({ bytes: (await req.arrayBuffer()).byteLength }), { headers: { 'content-type': 'application/json' } })
  }));
  const upload = new ResponseSink();
  await nativeApi.handler(request('/api/fixture/upload', { ...admittedHeaders, 'content-type': 'application/octet-stream' }, 'remote bytes', 'POST'), upload);
  assert.equal(upload.status, 200);
  assert.deepEqual(JSON.parse(upload.body), { bytes: 12 });

  const table = [];
  ctx.emit('webserver/index-inject', table);
  const metadata = table.find(row => row.name === '__DSH_LAN_CONNECT__');
  assert.equal(metadata.value.entryUrl, root + '/lan');
  assert.doesNotMatch(JSON.stringify(metadata), /token|cookie/i);

  await lan.dispose();
  assert.equal(routes.has('/lan'), false);
  assert.equal(routes.get('/api'), nativeApi);
  assert.equal(rawService(ctx, 'connection'), connection);
  assert.equal(connection.authorizeIndex(request('/', admittedHeaders), new ResponseSink()), true, 'disabling the entry does not revoke native cookies');
  assert.equal(connection.admit({ headers }).rejection, 401);
  const after = [];
  ctx.emit('webserver/index-inject', after);
  assert.equal(after.some(row => row.name === '__DSH_LAN_CONNECT__'), false);
  lan = ctx.plugin(plugin);
  await lan.await();
  assert.equal(routes.has('/lan'), true);
  await lan.dispose();
  assert.equal(routes.has('/lan'), false);
});
