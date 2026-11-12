/**
 * Read-only discovery of host MCP servers, workspaces, live agents, and the
 * skill catalog for one project directory.
 *
 * @module @local/dsh-mcp-skill-manager/host/discovery
 */

import {
  MCP_TOOL_PREFIX,
  isMcpServerName,
  isRecord,
  mcpServerOfToolName
} from '../shared/contract.js';
import { isWithin, sanitizeUrl } from './policy.js';

/** Package name of the shipped host MCP client. */
export const MCP_CLIENT_PACKAGE = '@deepseek-ai/dsh-mcp-client';

/** Service name of the managed MCP fleet, mounted from DSH 0.2.2-rc.2 on. */
export const MCP_MANAGER_SERVICE = 'mcpManager';

/** Maximum tool names retained per server in the panel snapshot. */
const MAX_LISTED_TOOLS = 100;

/** Read an optional Cordis service without throwing. */
export function service(ctx, name) {
  try {
    const value = ctx?.get?.(name);
    if (value !== undefined) return value;
  } catch {
    // Fall through to the property form.
  }
  try {
    return ctx?.[name];
  } catch {
    return undefined;
  }
}

/** Return the effective working directory of one live agent. */
export function agentCwd(ctx, agent) {
  const workingDirectory = service(ctx, 'workingDirectory');
  try {
    const value = workingDirectory?.get?.(agent?.session);
    if (typeof value === 'string' && value.length > 0) return value;
  } catch {
    // Fall through to the durable header.
  }
  const header = agent?.session?.header?.cwd;
  if (typeof header === 'string' && header.length > 0) return header;
  return process.cwd();
}

/** Return every live agent with its effective directory. */
export function liveAgentList(ctx) {
  const agents = service(ctx, 'agents');
  let list;
  try {
    list = agents?.list?.() ?? [];
  } catch {
    list = [];
  }
  return list.map((agent) => ({
    id: String(agent.id),
    cwd: agentCwd(ctx, agent),
    agent
  }));
}

/** Pick one live agent whose directory is inside `cwd`, preferring an exact match. */
function findLiveAgentForCwd(ctx, cwd, platform = process.platform) {
  const agents = liveAgentList(ctx);
  let nested;
  for (const entry of agents) {
    if (entry.cwd === cwd) return entry;
    if (nested === undefined && isWithin(entry.cwd, cwd, platform)) nested = entry;
  }
  return nested;
}

/** Read configured MCP client entries from the Cordis loader. */
export function loaderMcpServers(ctx) {
  const loader = service(ctx, 'loader');
  if (!loader?.entries) return { entries: [], loaderAvailable: false };
  const entries = [];
  try {
    for (const entry of loader.entries()) {
      const options = entry?.options;
      if (!options || options.name !== MCP_CLIENT_PACKAGE) continue;
      const config = options.config;
      if (!isRecord(config) || !isMcpServerName(config.serverName)) continue;
      let disabled = false;
      try {
        disabled = entry.disabled === true;
      } catch {
        // An unresolved loader expression is not proof that the entry is off.
      }
      const transport = config.transport === 'stdio' || config.transport === 'streamable-http' ? config.transport : undefined;
      const envKeys = isRecord(config.env) ? Object.keys(config.env).sort() : [];
      const headerKeys = isRecord(config.headers) ? Object.keys(config.headers).sort() : [];
      entries.push({
        serverName: config.serverName,
        transport,
        disabled,
        command: typeof config.command === 'string' ? config.command : undefined,
        argsCount: Array.isArray(config.args) ? config.args.length : undefined,
        url: sanitizeUrl(config.url),
        envKeys,
        headerKeys,
        cwdConfigured: typeof config.cwd === 'string' && config.cwd.length > 0
      });
    }
  } catch (error) {
    return { entries, loaderAvailable: true, error };
  }
  return { entries, loaderAvailable: true };
}

/** Read every globally registered MCP tool name. */
export function globalMcpToolNames(ctx) {
  const tools = service(ctx, 'tools');
  let definitions;
  try {
    definitions = tools?.definitions?.() ?? [];
  } catch {
    definitions = [];
  }
  const names = [];
  for (const definition of definitions) {
    const name = definition?.name;
    if (typeof name === 'string' && name.startsWith(MCP_TOOL_PREFIX)) names.push(name);
  }
  return names;
}

/**
 * Read servers owned by the managed MCP fleet.
 *
 * From DSH 0.2.2-rc.2 the shipped `web` profile mounts `dsh-mcp-manager` and
 * keeps its servers in that service's own configuration instead of one
 * `dsh-mcp-client` loader entry per server. Those servers therefore have no
 * profile entry to discover; the manager's `list()` is the only source. A
 * runtime without the service (0.2.2-rc.1 and earlier) returns nothing.
 *
 * @param ctx - host context.
 * @returns one row source per managed server.
 */
export function managerMcpServers(ctx) {
  const manager = service(ctx, MCP_MANAGER_SERVICE);
  if (typeof manager?.list !== 'function') return [];
  let views;
  try {
    views = manager.list();
  } catch {
    return [];
  }
  if (!Array.isArray(views)) return [];
  const rows = [];
  for (const view of views) {
    if (!isRecord(view)) continue;
    const { name, status } = view;
    if (!isMcpServerName(name)) continue;
    rows.push({
      serverName: name,
      transport: undefined,
      origin: 'manager',
      // A disabled entry keeps its place but asks for no running instance.
      disabled: isRecord(status) && status.state === 'disabled',
      command: undefined,
      argsCount: undefined,
      url: undefined,
      envKeys: [],
      headerKeys: [],
      cwdConfigured: false
    });
  }
  return rows;
}

/**
 * Merge loader configuration, the managed fleet, and live tool registrations
 * into server rows.
 * @returns {{ servers: object[], loaderAvailable: boolean }}
 */
export function discoverServers(ctx) {
  const { entries, loaderAvailable } = loaderMcpServers(ctx);
  const known = entries.map((entry) => entry.serverName);
  const map = new Map();
  for (const entry of entries) {
    const existing = map.get(entry.serverName);
    if (existing === undefined) {
      map.set(entry.serverName, {
        serverName: entry.serverName,
        transport: entry.transport,
        origin: 'profile',
        disabled: entry.disabled,
        command: entry.command,
        argsCount: entry.argsCount,
        url: entry.url,
        envKeys: entry.envKeys,
        headerKeys: entry.headerKeys,
        cwdConfigured: entry.cwdConfigured,
        toolNames: []
      });
    } else {
      // Any enabled entry keeps the namespace available.
      existing.disabled = existing.disabled && entry.disabled;
      existing.transport ??= entry.transport;
      existing.command ??= entry.command;
      existing.argsCount ??= entry.argsCount;
      existing.url ??= entry.url;
      existing.cwdConfigured ||= entry.cwdConfigured;
      for (const key of entry.envKeys) if (!existing.envKeys.includes(key)) existing.envKeys.push(key);
      for (const key of entry.headerKeys) if (!existing.headerKeys.includes(key)) existing.headerKeys.push(key);
    }
  }

  // A managed server has no profile entry of its own; a loader entry for the
  // same name keeps its configuration detail and wins here.
  for (const entry of managerMcpServers(ctx)) {
    if (map.has(entry.serverName)) continue;
    map.set(entry.serverName, { ...entry, toolNames: [] });
    known.push(entry.serverName);
  }

  const toolNames = globalMcpToolNames(ctx);
  for (const toolName of toolNames) {
    const serverName = mcpServerOfToolName(toolName, known);
    if (serverName === undefined) continue;
    let row = map.get(serverName);
    if (row === undefined) {
      row = {
        serverName,
        transport: undefined,
        origin: 'tools',
        disabled: false,
        command: undefined,
        argsCount: undefined,
        url: undefined,
        envKeys: [],
        headerKeys: [],
        cwdConfigured: false,
        toolNames: []
      };
      map.set(serverName, row);
      known.push(serverName);
    }
    row.toolNames.push(toolName);
  }

  const servers = [...map.values()].map((row) => {
    row.toolNames.sort();
    const total = row.toolNames.length;
    return {
      ...row,
      toolNames: row.toolNames.slice(0, MAX_LISTED_TOOLS),
      toolCount: total,
      toolsTruncated: total > MAX_LISTED_TOOLS,
      status: row.disabled ? 'disabled' : total > 0 ? 'active' : 'idle'
    };
  });
  servers.sort((left, right) => left.serverName.localeCompare(right.serverName));
  return { servers, loaderAvailable };
}

/** Return workspace directories as add-project suggestions. */
export async function workspaceSuggestions(ctx) {
  const registry = service(ctx, 'workspaceRegistry');
  if (!registry?.list) return [];
  let workspaces;
  try {
    workspaces = await Promise.resolve(registry.list());
  } catch {
    return [];
  }
  if (!Array.isArray(workspaces)) return [];
  const seen = new Set();
  const result = [];
  for (const workspace of workspaces) {
    if (!isRecord(workspace) || typeof workspace.path !== 'string') continue;
    if (seen.has(workspace.path)) continue;
    seen.add(workspace.path);
    result.push({
      path: workspace.path,
      title: typeof workspace.title === 'string' && workspace.title.length > 0 ? workspace.title : workspace.path
    });
  }
  return result;
}

/**
 * Discover the skill catalog for one project directory.
 *
 * A live agent in the directory contributes its exact preset; otherwise the
 * default preset scope is used, and global providers are the final fallback.
 * The returned catalog is invocation-neutral and does not include policy
 * stubs, because scopes are borrowed from the preset rather than an agent.
 *
 * @param {object} ctx - host context.
 * @param {string} cwd - absolute project directory.
 * @param {AbortSignal} [signal] - cancellation.
 */
export async function discoverSkills(ctx, cwd, signal) {
  const skills = service(ctx, 'skills');
  if (!skills?.snapshot) {
    return { unavailable: true, skills: [], complete: false, preset: null, warning: null };
  }
  const agent = findLiveAgentForCwd(ctx, cwd);
  const presets = service(ctx, 'agentPresets');
  let snapshot;
  let warning = null;
  let preset = null;

  if (presets?.acquireScope) {
    let lease;
    try {
      let presetId;
      if (agent !== undefined && typeof presets.composedPreset === 'function') {
        try {
          presetId = presets.composedPreset(agent.agent.ctx);
        } catch {
          presetId = undefined;
        }
      }
      lease = await presets.acquireScope(presetId);
      preset = presetId ?? (typeof presets.defaultId === 'string' ? presets.defaultId : null);
      snapshot = await skills.snapshot({ cwd, scope: lease.key, signal });
    } catch (error) {
      if (signal?.aborted === true) throw error;
      warning = error instanceof Error ? error.message : String(error);
    } finally {
      if (lease !== undefined) {
        try {
          await lease[Symbol.asyncDispose]();
        } catch {
          // Disposing the read lease is best-effort.
        }
      }
    }
  }

  if (snapshot === undefined && agent !== undefined) {
    try {
      snapshot = await skills.snapshot({ cwd, scope: agent.agent, signal });
      if (preset === null && typeof presets?.composedPreset === 'function') {
        try {
          preset = presets.composedPreset(agent.agent.ctx) ?? null;
        } catch {
          preset = null;
        }
      }
    } catch (error) {
      if (signal?.aborted === true) throw error;
      warning ??= error instanceof Error ? error.message : String(error);
    }
  }

  if (snapshot === undefined) {
    snapshot = await skills.snapshot({ cwd, signal });
  }

  const summaries = Array.isArray(snapshot?.skills) ? snapshot.skills : [];
  const skillsOut = summaries.map((summary) => ({
    name: summary.name,
    description: summary.description,
    ...(summary.whenToUse === undefined ? {} : { whenToUse: summary.whenToUse }),
    source: summary.source,
    provider: summary.provider,
    ...(summary.path === undefined ? {} : { path: summary.path }),
    invocation: {
      modelInvocable: summary.invocation?.modelInvocable === true,
      userInvocable: summary.invocation?.userInvocable === true
    }
  }));
  skillsOut.sort((left, right) => left.name.localeCompare(right.name));
  return {
    unavailable: false,
    skills: skillsOut,
    complete: snapshot?.complete !== false,
    preset,
    warning
  };
}
