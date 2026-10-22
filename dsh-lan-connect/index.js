import { networkInterfaces } from "node:os";

export const name = "dsh-lan-connect";
export const inject = ["webServer", "webApp", "connection"];
export const ENTRY_PATH = "/lan";
export const BOOT_GLOBAL = "__DSH_LAN_CONNECT__";

const RESPONSE_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "content-type": "text/plain; charset=utf-8",
  "x-content-type-options": "nosniff"
});

/** A configured root, never an incoming Host, query, or forwarded header. */
function appRoot(ctx) {
  const root = new URL(ctx.webApp.getAdvertisedUrl());
  if (!['http:', 'https:'].includes(root.protocol) || root.username || root.password || root.search || root.hash || !root.pathname.endsWith('/')) {
    throw new Error("dsh-lan-connect: the advertised Web root must be a credential-free HTTP(S) directory URL");
  }
  return root;
}

/** Only RFC1918 IPv4 candidates; no reachability or route-selection claims. */
function privateIPv4(address) {
  const parts = address.split('.').map(Number);
  return parts.length === 4 && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255)
    && (parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168));
}

/** Public metadata for the settings card. No token or cookie crosses this boundary. */
export function connectionInfo(ctx, interfaces = networkInterfaces()) {
  const root = appRoot(ctx);
  const origin = new URL(ctx.webServer.getOrigin());
  const port = ctx.webServer.port;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("dsh-lan-connect: Web listener is not ready");
  const host = ctx.webServer.host;
  const loopback = origin.hostname.startsWith('127.') || origin.hostname === '[::1]' || origin.hostname === '::1';
  const lanAddresses = Object.entries(interfaces).flatMap(([name, addresses]) => (addresses ?? [])
    .filter(address => !address.internal && address.family === 'IPv4' && privateIPv4(address.address))
    .map(address => ({ name, address: address.address, bound: address.address === host })));
  return {
    entryUrl: new URL(ENTRY_PATH.slice(1), root).href,
    host,
    port,
    protocol: ctx.webServer.protocol,
    loopback,
    lanAddresses
  };
}

function respond(res, status, body, headers = {}) {
  res.writeHead(status, { ...RESPONSE_HEADERS, ...headers });
  res.end(body);
}

/**
 * Deliberately anonymous operator admission, not a second authentication scheme.
 * Native trust checks run first; native token exchange, cookies, API admission,
 * Peers, and WebSocket admission remain untouched.
 */
export function createEntryHandler(ctx) {
  return (req, res) => {
    if (req.method !== 'GET') {
      respond(res, 405, "Use GET to open the LAN entry.\n", { allow: 'GET' });
      return;
    }
    let destination;
    try {
      const rejection = ctx.connection.requestRejection(req);
      if (rejection === 403) {
        respond(res, 403, "Forbidden.\n");
        return;
      }
      // 401 means the native trust fence passed but no live credential exists.
      // This explicit entry grants access in that case. Fail closed on new statuses.
      if (rejection !== undefined && rejection !== 401) {
        respond(res, 503, "LAN entry unavailable.\n");
        return;
      }
      const root = appRoot(ctx);
      destination = new URL(ctx.connection.authenticatedUrl(root.href));
      // Assert the public contract before putting a credential in Location.
      // Never accept redirect destinations from request headers or parameters.
      if (destination.origin !== root.origin || destination.pathname !== root.pathname || destination.username || destination.password || destination.hash
        || destination.searchParams.size !== 1 || destination.searchParams.getAll('token').length !== 1 || !destination.searchParams.get('token')) {
        throw new Error("unexpected native authentication URL");
      }
    } catch {
      // Do not log the error: a changed provider may include a credential in it.
      respond(res, 503, "LAN entry unavailable.\n");
      return;
    }
    respond(res, 303, "Opening DSH.\n", { location: destination.href });
  };
}

/** Register additions only; the listener and Connection are never replaced. */
export function apply(ctx) {
  for (const [service, methods] of [
    ['webServer', ['register', 'getOrigin']],
    ['webApp', ['getAdvertisedUrl']],
    ['connection', ['requestRejection', 'authenticatedUrl']]
  ]) {
    for (const method of methods) {
      if (typeof ctx[service]?.[method] !== 'function') throw new Error(`dsh-lan-connect: required public API ${service}.${method} is unavailable`);
    }
  }
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: ENTRY_PATH, handler: createEntryHandler(ctx) }), 'dsh-lan-connect: automatic sign-in entry');
  ctx.on('webserver/index-inject', table => {
    try {
      table.push({ kind: 'global', name: BOOT_GLOBAL, value: connectionInfo(ctx) });
    } catch {
      // Never fail the whole index render: an absent row makes the card show
      // "unavailable" instead. No logger call: a provider error may carry a
      // credential.
    }
  });
  // webServer registers its service before [Service.init] finishes listening,
  // so this fiber may activate while the port is still unbound. The route and
  // the index row resolve their facts later; only this startup log is eager.
  let info;
  try {
    info = connectionInfo(ctx);
  } catch {
    ctx.logger.info('LAN automatic sign-in entry registered; the listener was not bound yet, so its URL is resolved on first page render.');
    return;
  }
  ctx.logger.info(`LAN automatic sign-in entry (grants operator access): ${info.entryUrl}`);
  if (info.loopback) ctx.logger.warn('The listener is loopback-only. Other LAN devices need a concrete LAN bind IP or an existing trusted proxy. The plugin does not change the bind address or port.');
}

export default { name, inject, apply };
