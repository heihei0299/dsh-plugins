import { ENTRY_PATH, isPrivateIPv4 } from '../shared/contract.js';

/**
 * Whether an advertised URL hostname is the loopback authority.
 *
 * Kept separate from the Host's listener-origin check on purpose: the Host
 * classifies the bound address, while the Client classifies an advertised root
 * that a proxy may have rewritten (and may legitimately say `localhost`).
 * @param hostname - WHATWG URL hostname (IPv6 literals keep brackets).
 * @returns true for localhost, ::1, or any 127/8 literal.
 */
function isLoopbackHostname(hostname) {
  const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  return bare === 'localhost' || bare === '::1' || /^127\./.test(bare);
}

/**
 * Whether one value is a plain record (not null, not an array).
 * @param value - candidate bootstrap member.
 * @returns true for an object record.
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse an absolute HTTP(S) URL without throwing.
 * @param value - candidate URL string.
 * @returns the parsed URL, or null when absent, relative, or non-HTTP(S).
 */
function parseHttpUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * Narrow the Host's injected record onto the shape this card renders.
 *
 * Unknown or inconsistent records produce null — the card then shows an
 * "unavailable" notice instead of a guessed entry URL. Individual malformed
 * LAN entries are dropped rather than inventing fields for them.
 * @param value - `globalThis.__DSH_LAN_CONNECT__`, which is untrusted input.
 * @returns a frozen record, or null when the record cannot be displayed.
 */
export function readBootstrap(value) {
  if (!isRecord(value)) return null;
  const { entryUrl, host, port, protocol, loopback, lanAddresses } = value;
  const entry = parseHttpUrl(entryUrl);
  if (entry === null) return null;
  // The Host publishes a clean entry URL. Never present credentials, a query,
  // a fragment, or an unknown path if the global was tampered with.
  if (entry.username !== '' || entry.password !== '' || entry.search !== '' || entry.hash !== '') return null;
  if (!entry.pathname.endsWith(ENTRY_PATH)) return null;
  if (typeof host !== 'string' || host.trim() === '') return null;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (protocol !== 'http:' && protocol !== 'https:') return null;
  // The advertised root may be an HTTPS proxy in front of a plain-HTTP
  // listener, so the entry scheme and the listener protocol may differ.
  if (typeof loopback !== 'boolean') return null;
  if (!Array.isArray(lanAddresses)) return null;
  const candidates = [];
  for (const candidate of lanAddresses) {
    if (!isRecord(candidate)) continue;
    const { name, address, bound } = candidate;
    if (typeof name !== 'string' || name.trim() === '') continue;
    // The Host publishes RFC 1918 IPv4 candidates only; anything else is not
    // an address this card may present as a LAN suggestion.
    if (typeof address !== 'string' || !isPrivateIPv4(address.trim())) continue;
    if (typeof bound !== 'boolean') continue;
    candidates.push(Object.freeze({ name: name.trim(), address: address.trim(), bound }));
  }
  // The listener and the advertised entry need not share an authority: a
  // trusted proxy may publish a LAN/HTTPS root while DSH itself listens on
  // loopback. Reachability follows the entry, not the internal listener.
  const advertisedPort = entry.port === '' ? (entry.protocol === 'https:' ? 443 : 80) : Number(entry.port);
  if (!Number.isInteger(advertisedPort) || advertisedPort < 1 || advertisedPort > 65535) return null;
  return Object.freeze({
    entryUrl: entry.href,
    host: host.trim(),
    port,
    protocol,
    loopback,
    advertisedHost: entry.hostname,
    advertisedPort,
    advertisedProtocol: entry.protocol,
    advertisedLoopback: isLoopbackHostname(entry.hostname),
    lanAddresses: Object.freeze(candidates),
  });
}

/**
 * Suggest the entry URL on one LAN address by replacing only its host.
 *
 * The suggestion keeps the entry's own scheme, port, and path and is never
 * shown as reachable: the card labels every candidate as an unverified
 * suggestion. Only a validated private IPv4 literal is accepted, so an
 * arbitrary or malformed value cannot forge a different URL shape.
 * @param bootstrap - normalized record from {@link readBootstrap}.
 * @param address - candidate interface address.
 * @returns the suggested absolute URL, or null when none can be composed.
 */
export function lanSuggestUrl(bootstrap, address) {
  if (!isRecord(bootstrap)) return null;
  if (typeof address !== 'string') return null;
  const trimmed = address.trim();
  if (!isPrivateIPv4(trimmed)) return null;
  const entry = parseHttpUrl(bootstrap.entryUrl);
  if (entry === null) return null;
  if (entry.username !== '' || entry.password !== '' || entry.search !== '' || entry.hash !== '') return null;
  const authority = entry.port === '' ? trimmed : `${trimmed}:${entry.port}`;
  const path = entry.pathname === '' ? '/' : entry.pathname;
  return `${entry.protocol}//${authority}${path}`;
}
