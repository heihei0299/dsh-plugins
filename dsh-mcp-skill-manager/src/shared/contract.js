/**
 * Shared, dependency-free contract for the MCP & Skill manager.
 *
 * The Host half and the browser bundle import this module, so it must stay
 * free of Node built-ins and browser globals.
 *
 * @module @local/dsh-mcp-skill-manager/shared/contract
 */

/** Package identity used by the client module loader. */
export const PACKAGE_NAME = '@local/dsh-mcp-skill-manager';

/** Web Settings section registration identity. */
export const SETTINGS_ID = 'mcp-skill-manager';
export const SETTINGS_ORDER = 60;

/** Browser dictionary namespace. */
export const LOCALE_NS = 'mcpSkillManager';

/** Prefix of every host-global MCP tool name. */
export const MCP_TOOL_PREFIX = 'mcp__';

/** Shared resource tools owned by the MCP resource runtime. */
export const MCP_RESOURCE_TOOLS = Object.freeze([
  'list_mcp_resources',
  'list_mcp_resource_templates',
  'read_mcp_resource'
]);

/** System prompt section name prefix used by every MCP server. */
export const MCP_SECTION_PREFIX = 'mcp:';

/** System prompt section owned by the MCP resource runtime. */
export const MCP_RESOURCE_SECTION = 'mcp-resource-servers';

/** Central placement name for MCP prompt sections. */
export const MCP_SERVERS_ORDER_NAME = 'MCP_SERVERS';

/** Fallback order when the host does not expose the placement name. */
export const MCP_SERVERS_FALLBACK_ORDER = 3100;

/** Policy document version. */
export const POLICY_VERSION = 1;

/** Runtime skill source marker used by policy stubs. */
export const SKILL_SOURCE = 'mcp-skill-manager';

/** API mount under Connection's authenticated `/api` channel. */
export const API_PREFIX = '/api/mcp-skill-manager';
export const API_STATE_PATH = `${API_PREFIX}/state`;
export const API_SKILLS_PATH = `${API_PREFIX}/skills`;
export const API_CONFIG_PATH = `${API_PREFIX}/config`;
export const API_RELATIVE_PREFIX = 'api/mcp-skill-manager';

/** Maximum accepted policy request body. */
export const CONFIG_BODY_LIMIT = 256 * 1024;

/** Validation limits shared by the host and the panel. */
export const PROJECT_LIMIT = 200;
export const SERVER_LIMIT = 200;
export const SKILL_LIMIT = 500;
export const LABEL_LIMIT = 120;
export const PATH_LIMIT = 4096;

/** MCP server namespace grammar (matches @deepseek-ai/dsh-mcp-client). */
export const MCP_SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/;

/** Skill name grammar (matches @deepseek-ai/dsh-skill). */
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Return whether a value is a valid MCP server namespace. */
export function isMcpServerName(value) {
  return typeof value === 'string' && MCP_SERVER_NAME.test(value);
}

/** Return whether a value is a valid skill name. */
export function isSkillName(value) {
  return typeof value === 'string' && SKILL_NAME.test(value);
}

/**
 * Split one public MCP tool name into its server and raw tool names.
 *
 * Known server names are consulted first so a server name containing `__`
 * keeps its exact identity. Without a match, the first separator is used;
 * that fallback is ambiguous only for unknown servers whose own name contains
 * a double underscore.
 *
 * @param {unknown} name - model-facing tool name.
 * @param {Iterable<string>} [knownServerNames] - configured server names.
 * @returns {{ serverName: string, rawName: string } | undefined}
 */
export function parseMcpToolName(name, knownServerNames = []) {
  if (typeof name !== 'string' || !name.startsWith(MCP_TOOL_PREFIX)) return undefined;
  let best;
  for (const serverName of knownServerNames) {
    if (!isMcpServerName(serverName)) continue;
    if (name.startsWith(`${MCP_TOOL_PREFIX}${serverName}__`)) {
      if (best === undefined || serverName.length > best.length) best = serverName;
    }
  }
  if (best !== undefined) {
    const rest = name.slice(MCP_TOOL_PREFIX.length + best.length + 2);
    return rest.length > 0 ? { serverName: best, rawName: rest } : undefined;
  }
  const body = name.slice(MCP_TOOL_PREFIX.length);
  const split = body.indexOf('__');
  if (split < 1 || split > 32) return undefined;
  const serverName = body.slice(0, split);
  const rawName = body.slice(split + 2);
  return isMcpServerName(serverName) && rawName.length > 0 ? { serverName, rawName } : undefined;
}

/** Read only the server namespace of one MCP tool name. */
export function mcpServerOfToolName(name, knownServerNames = []) {
  return parseMcpToolName(name, knownServerNames)?.serverName;
}

/** Narrow an unknown value to a plain record. */
export function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
