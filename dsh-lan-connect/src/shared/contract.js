/**
 * Host/Client contract for the LAN entry.
 *
 * Both halves must agree on the route and on the bootstrap global that carries
 * the read-only settings record. The browser half still validates the record
 * shape itself: sharing this module is not a reason to trust Host output.
 */

/** Route appended to the advertised Web root; never selected from a request. */
export const ENTRY_PATH = '/lan';

/** Structured index global that carries the read-only settings record. */
export const BOOTSTRAP_KEY = '__DSH_LAN_CONNECT__';

/**
 * Whether one string is a private (RFC 1918) IPv4 literal.
 *
 * Strict dotted-quad syntax: the Host receives OS interface data and the Client
 * receives untrusted global metadata, so both sides need the same exact rule.
 * @param value - candidate address text.
 * @returns true for 10/8, 172.16/12, or 192.168/16.
 */
export function isPrivateIPv4(value) {
  if (typeof value !== 'string') return false;
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  if (!parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)) return false;
  const [a, b] = parts.map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
