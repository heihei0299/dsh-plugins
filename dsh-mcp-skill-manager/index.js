/**
 * Compatibility entry for hosts that imported the package root before the
 * dsh-go native entry moved to `lib/index.js`.
 *
 * @module @local/dsh-mcp-skill-manager
 */

export * from './lib/index.js';
export { default } from './lib/index.js';
