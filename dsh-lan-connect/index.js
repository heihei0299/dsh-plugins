import { networkInterfaces } from "node:os";
import { BOOTSTRAP_KEY, ENTRY_PATH, isPrivateIPv4 } from "./src/shared/contract.js";

export const name = "dsh-lan-connect";
export const inject = ["webServer", "webApp", "connection"];
export { BOOTSTRAP_KEY, ENTRY_PATH };

const RESPONSE_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "content-type": "text/plain; charset=utf-8",
  "x-content-type-options": "nosniff"
});

/**
 * The only failure causes this plugin distinguishes. Diagnostics name one of
 * these instead of an exception, URL, token, or provider text: a changed
 * provider may carry a credential in its message.
 */
const FAILURE = Object.freeze({
  LISTENER_NOT_READY: "listener-not-ready",
  ORIGIN_UNAVAILABLE: "origin-unavailable",
  ADVERTISED_ROOT_INVALID: "advertised-root-invalid"
});

const FAILURE_MESSAGE = Object.freeze({
  [FAILURE.LISTENER_NOT_READY]: "dsh-lan-connect: Web listener is not ready",
  [FAILURE.ORIGIN_UNAVAILABLE]: "dsh-lan-connect: the Web listener is bound, but its origin or advertised Web root is unavailable",
  [FAILURE.ADVERTISED_ROOT_INVALID]: "dsh-lan-connect: the advertised Web root must be a credential-free HTTP(S) directory URL"
});

class LanEntryUnavailable extends Error {
  constructor(reason) {
    super(FAILURE_MESSAGE[reason]);
    this.reason = reason;
  }
}

/** The classified cause, or undefined for an unknown provider failure. */
function failureReason(error) {
  return error instanceof LanEntryUnavailable ? error.reason : undefined;
}

/** The bound listening port, or undefined when no socket has bound one. */
function boundPort(ctx) {
  const port = ctx.webServer.port;
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : undefined;
}

/**
 * A configured root, never an incoming Host, query, or forwarded header.
 *
 * The Host advertises its configured `publicUrl`, or `webServer.getOrigin()`
 * as the fallback. A throwing `getAdvertisedUrl()` does not by itself prove
 * that the listener is unbound: a bound listener may also reject a bind
 * address that has no URL form. Only an unbound port is not-ready evidence.
 */
function appRoot(ctx) {
  let advertised;
  try {
    advertised = ctx.webApp.getAdvertisedUrl();
  } catch {
    // Do not inspect or log the error: it may carry a credential or URL.
    throw new LanEntryUnavailable(boundPort(ctx) === undefined ? FAILURE.LISTENER_NOT_READY : FAILURE.ORIGIN_UNAVAILABLE);
  }
  let root;
  try {
    root = new URL(advertised);
  } catch {
    // The URL constructor message can echo the configured value.
    throw new LanEntryUnavailable(FAILURE.ADVERTISED_ROOT_INVALID);
  }
  if (!['http:', 'https:'].includes(root.protocol) || root.username || root.password || root.search || root.hash || !root.pathname.endsWith('/')) {
    throw new LanEntryUnavailable(FAILURE.ADVERTISED_ROOT_INVALID);
  }
  return root;
}

/**
 * The listening port and its local origin.
 *
 * `webServer.port` is `undefined` until `listen` binds; that is the only
 * unbound evidence. Once a port is bound, `getOrigin()` can still throw when
 * the bind address has no URL form (for example an interface zone id), so
 * that failure is reported as an unavailable origin, not as not-ready.
 */
function listenerState(ctx) {
  const port = boundPort(ctx);
  if (port === undefined) throw new LanEntryUnavailable(FAILURE.LISTENER_NOT_READY);
  let origin;
  try {
    origin = new URL(ctx.webServer.getOrigin());
  } catch {
    throw new LanEntryUnavailable(FAILURE.ORIGIN_UNAVAILABLE);
  }
  return { origin, port };
}

/** Public metadata for the settings card. No token or cookie crosses this boundary. */
export function connectionInfo(ctx, interfaces = networkInterfaces()) {
  // Validate the advertised root first: at startup the listener has not bound
  // yet, and collapsing both causes would misreport a bad root as not-ready.
  const root = appRoot(ctx);
  const { origin, port } = listenerState(ctx);
  const host = ctx.webServer.host;
  const loopback = origin.hostname.startsWith('127.') || origin.hostname === '[::1]' || origin.hostname === '::1';
  const lanAddresses = Object.entries(interfaces).flatMap(([name, addresses]) => (addresses ?? [])
    .filter(address => !address.internal && address.family === 'IPv4' && isPrivateIPv4(address.address))
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
      // Do not log the error: a changed provider may include a credential in
      // it. Request-driven failures also must not be able to flood the log;
      // startup and index rendering report fixed, classified causes once.
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
  const reported = new Set();
  /**
   * Emit one fixed diagnostic per distinguishable cause per activation.
   *
   * Index rendering can fail on every request while the listener is unbound,
   * so the set keeps that from flooding the log. Unknown provider failures
   * stay silent because their text may carry a credential.
   */
  const report = error => {
    const reason = failureReason(error);
    if (reason === undefined || reported.has(reason)) return;
    reported.add(reason);
    if (reason === FAILURE.ADVERTISED_ROOT_INVALID) {
      ctx.logger.warn('LAN automatic sign-in entry registered; the advertised Web root is invalid, so /lan answers 503 until it is a credential-free HTTP(S) directory URL.');
      return;
    }
    if (reason === FAILURE.ORIGIN_UNAVAILABLE) {
      ctx.logger.warn('LAN automatic sign-in entry registered; the Web listener is bound, but its origin or advertised root is unavailable. The settings card may be unavailable.');
      return;
    }
    ctx.logger.info('LAN automatic sign-in entry registered; the listener was not bound yet, so its URL is resolved on first page render.');
  };
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: ENTRY_PATH, handler: createEntryHandler(ctx) }), 'dsh-lan-connect: automatic sign-in entry');
  ctx.on('webserver/index-inject', table => {
    try {
      table.push({ kind: 'global', name: BOOTSTRAP_KEY, value: connectionInfo(ctx) });
    } catch (error) {
      // Never fail the whole index render: an absent row makes the card show
      // "unavailable" instead. Report only the fixed, classified cause.
      report(error);
    }
  });
  // webServer registers its service before [Service.init] finishes listening,
  // so this fiber may activate while the port is still unbound. The route and
  // the index row resolve their facts later; only this startup log is eager.
  let info;
  try {
    info = connectionInfo(ctx);
  } catch (error) {
    // A real unbound listener (or an unavailable bound origin) is expected
    // here and is not a hard error; only the fixed, classified cause is
    // reported, and unknown/provider text is never logged.
    report(error);
    return;
  }
  ctx.logger.info(`LAN automatic sign-in entry (grants operator access): ${info.entryUrl}`);
  if (info.loopback) ctx.logger.warn('The listener is loopback-only. Other LAN devices need a concrete LAN bind IP or an existing trusted proxy. The plugin does not change the bind address or port.');
}

export default { name, inject, apply };
