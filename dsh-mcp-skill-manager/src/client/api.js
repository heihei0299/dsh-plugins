/**
 * Relative, same-origin API access for the panel.
 *
 * Paths intentionally omit a leading slash so the panel keeps working when
 * the Web app is mounted under a path prefix.
 *
 * @module @local/dsh-mcp-skill-manager/client/api
 */

import { API_RELATIVE_PREFIX } from '../shared/contract.js';

/** Failure returned by the host API. */
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** Resolve one relative API path against the current document. */
function endpoint(path) {
  const base = typeof document === 'undefined' ? 'http://localhost/' : document.baseURI;
  return new URL(path, base);
}

/** Perform one JSON request and normalize failures. */
async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(endpoint(path), {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...options.headers
      },
      ...(options.body === undefined ? {} : { body: options.body }),
      ...(options.signal === undefined ? {} : { signal: options.signal })
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError(0, 'network-failed', error instanceof Error ? error.message : 'Network request failed');
  }
  let payload;
  const text = await response.text();
  try {
    payload = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    payload = undefined;
  }
  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'request-failed',
      payload?.error?.message ?? response.statusText ?? 'Request failed'
    );
  }
  return payload;
}

/** Load the complete panel state. */
export function fetchState(signal) {
  return request(`${API_RELATIVE_PREFIX}/state`, { signal });
}

/** Load one directory's skill catalog. */
export function fetchSkills(cwd, signal) {
  return request(`${API_RELATIVE_PREFIX}/skills?cwd=${encodeURIComponent(cwd)}`, { signal });
}

/** Save the complete policy document. */
export function saveConfig(config, signal) {
  return request(`${API_RELATIVE_PREFIX}/config`, {
    method: 'POST',
    body: JSON.stringify(config),
    signal
  });
}
