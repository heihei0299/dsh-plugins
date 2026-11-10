/**
 * Host half of @local/dsh-mcp-skill-manager.
 *
 * Reads a profile-independent policy file, enforces per-project MCP tool and
 * prompt visibility, suppresses disabled skills, and exposes the panel API on
 * Connection's authenticated `/api` channel.
 *
 * @module @local/dsh-mcp-skill-manager
 */

import { createConfigStore } from './src/host/config-store.js';
import { createManager } from './src/host/manager.js';
import { createApi, registerApi } from './src/host/api.js';

/** Stable Cordis plugin name. */
export const name = 'mcp-skill-manager';

/** Services required before the policy can be attached to live agents. */
export const inject = ['tools', 'agents'];

/**
 * Load the policy, attach it to existing agents, and register the panel API.
 * @param {object} ctx - host Cordis context.
 * @param {{ stateFile?: string }} [config] - optional plugin config.
 */
export async function apply(ctx, config) {
  const logger = ctx.logger;
  const store = createConfigStore({ file: config?.stateFile, logger });
  if (store.resolveWarning !== undefined) logger.warn(`mcp-skill-manager: ${store.resolveWarning}`);
  const loaded = store.readSync();
  if (loaded.error !== null) logger.warn(`mcp-skill-manager: policy file ignored: ${loaded.error.message}`);

  const manager = createManager({ ctx, store, logger });
  ctx.effect(() => () => manager.dispose(), 'mcp-skill-manager: policy effects');
  await manager.start();

  const api = createApi({ ctx, manager, store, logger });
  registerApi(ctx, api);
}

export default { name, inject, apply };
