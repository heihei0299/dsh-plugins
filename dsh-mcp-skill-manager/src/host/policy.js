/**
 * Policy document normalization, project matching, and per-agent filters.
 *
 * This module is host-only. It performs no filesystem I/O; callers pass a
 * `canonicalize` callback so tests can keep path handling pure.
 *
 * @module @local/dsh-mcp-skill-manager/host/policy
 */

import path from 'node:path';
import {
  LABEL_LIMIT,
  MCP_RESOURCE_TOOLS,
  PATH_LIMIT,
  POLICY_VERSION,
  PROJECT_LIMIT,
  SERVER_LIMIT,
  SKILL_LIMIT,
  isMcpServerName,
  isRecord,
  isSkillName
} from '../shared/contract.js';

/** Validation failure with a stable machine-readable code. */
export class PolicyError extends Error {
  /** @param {string} message - correction-oriented detail without secret values. */
  constructor(message) {
    super(message);
    this.name = 'PolicyError';
    this.code = 'invalid-policy';
  }
}

/** A policy with no project entries. */
export function defaultPolicy() {
  return { version: POLICY_VERSION, projects: [] };
}

/** @param {string} platform - Node platform string. */
function pathApi(platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

/** Strip a Windows extended-length prefix for display and comparison. */
function stripWindowsPrefix(value) {
  if (value.startsWith('\\\\?\\UNC\\')) return `\\\\${value.slice(8)}`;
  if (value.startsWith('\\\\?\\')) return value.slice(4);
  return value;
}

/**
 * Normalize one absolute path for storage and comparison.
 * @param {unknown} value - candidate path.
 * @param {string} [platform] - Node platform string.
 * @returns {string} normalized absolute path.
 * @throws {PolicyError} when the value is not an absolute path.
 */
export function normalizePath(value, platform = process.platform) {
  if (typeof value !== 'string') throw new PolicyError('Project path must be a string');
  if (value.includes('\0')) throw new PolicyError('Project path must not contain NUL');
  if (value.trim().length === 0) throw new PolicyError('Project path must not be empty');
  if (value.length > PATH_LIMIT) throw new PolicyError(`Project path must be at most ${PATH_LIMIT} characters`);
  const api = pathApi(platform);
  let normalized = platform === 'win32' ? stripWindowsPrefix(value) : value;
  if (!api.isAbsolute(normalized)) throw new PolicyError(`Project path must be absolute: ${JSON.stringify(value)}`);
  normalized = api.normalize(normalized);
  const root = api.parse(normalized).root;
  if (normalized.length > root.length && normalized.endsWith(api.sep)) normalized = normalized.slice(0, -1);
  return normalized;
}

/** Comparison key for one normalized path. */
function pathKey(value, platform = process.platform) {
  let normalized = value;
  try {
    normalized = normalizePath(value, platform);
  } catch {
    // Comparison of a rejected path is only used by tests and defensive reads.
  }
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/** Default label for a project path. */
function defaultLabel(projectPath, platform) {
  const api = pathApi(platform);
  return api.basename(projectPath) || projectPath;
}

/** Normalize a mode field. */
function normalizeMode(value, field) {
  if (value === undefined) return 'all';
  if (value !== 'all' && value !== 'selected') throw new PolicyError(`${field}.mode must be "all" or "selected"`);
  return value;
}

/** Normalize a string list with a name validator. */
function normalizeNames(value, field, validator, limit) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new PolicyError(`${field} must be an array`);
  if (value.length > limit) throw new PolicyError(`${field} may contain at most ${limit} entries`);
  const seen = new Set();
  const result = [];
  for (const item of value) {
    if (!validator(item)) throw new PolicyError(`${field} contains an invalid name: ${JSON.stringify(item)}`);
    if (seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  return result;
}

/**
 * Validate and normalize one policy document.
 *
 * Missing `mcp`/`skills` sections default to `{ mode: 'all', ... }`. For a
 * `selected` section the saved list remains the allowlist; for `all` the list
 * is retained so a UI can switch modes without losing the selection.
 *
 * @param {unknown} input - untrusted JSON document.
 * @param {{ platform?: string, canonicalize?: (value: string) => { path: string, exists?: boolean, directory?: boolean } }} [options]
 * @returns {{ policy: object, warnings: Array<{ code: string, path?: string, message: string }> }}
 * @throws {PolicyError} when the document is invalid.
 */
export function normalizePolicy(input, options = {}) {
  const platform = options.platform ?? process.platform;
  const canonicalize = options.canonicalize ?? ((value) => ({ path: value, exists: true, directory: true }));
  if (!isRecord(input)) throw new PolicyError('Policy must be a JSON object');
  const version = input.version ?? POLICY_VERSION;
  if (version !== POLICY_VERSION) throw new PolicyError(`Unsupported policy version: ${JSON.stringify(version)}`);
  if (input.projects !== undefined && !Array.isArray(input.projects)) throw new PolicyError('projects must be an array');
  const projects = input.projects ?? [];
  if (projects.length > PROJECT_LIMIT) throw new PolicyError(`projects may contain at most ${PROJECT_LIMIT} entries`);

  const warnings = [];
  const seen = new Set();
  const normalized = [];
  for (const [index, raw] of projects.entries()) {
    if (!isRecord(raw)) throw new PolicyError(`projects[${index}] must be an object`);
    let projectPath = normalizePath(raw.path, platform);
    let canonical;
    try {
      canonical = canonicalize(projectPath);
    } catch (error) {
      throw new PolicyError(`projects[${index}].path could not be resolved: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (canonical !== undefined && typeof canonical.path === 'string') projectPath = normalizePath(canonical.path, platform);
    if (canonical?.exists === true && canonical.directory === false) throw new PolicyError(`projects[${index}].path is not a directory`);
    if (canonical?.exists === false) {
      warnings.push({ code: 'missing-directory', path: projectPath, message: 'Project directory does not exist' });
    }
    const key = pathKey(projectPath, platform);
    if (seen.has(key)) throw new PolicyError(`Duplicate project directory: ${JSON.stringify(projectPath)}`);
    seen.add(key);

    let label = raw.label;
    if (label === undefined) label = defaultLabel(projectPath, platform);
    if (typeof label !== 'string') throw new PolicyError(`projects[${index}].label must be a string`);
    label = label.trim();
    if (label.length === 0) label = defaultLabel(projectPath, platform);
    if (label.length > LABEL_LIMIT) throw new PolicyError(`projects[${index}].label must be at most ${LABEL_LIMIT} characters`);
    if (/[\u0000-\u001f\u007f]/.test(label)) throw new PolicyError(`projects[${index}].label must not contain control characters`);

    const mcpRaw = raw.mcp ?? {};
    if (!isRecord(mcpRaw)) throw new PolicyError(`projects[${index}].mcp must be an object`);
    const skillsRaw = raw.skills ?? {};
    if (!isRecord(skillsRaw)) throw new PolicyError(`projects[${index}].skills must be an object`);

    normalized.push({
      path: projectPath,
      label,
      mcp: {
        mode: normalizeMode(mcpRaw.mode, `projects[${index}].mcp`),
        servers: normalizeNames(mcpRaw.servers, `projects[${index}].mcp.servers`, isMcpServerName, SERVER_LIMIT)
      },
      skills: {
        mode: normalizeMode(skillsRaw.mode, `projects[${index}].skills`),
        names: normalizeNames(skillsRaw.names, `projects[${index}].skills.names`, isSkillName, SKILL_LIMIT)
      }
    });
  }

  return { policy: { version: POLICY_VERSION, projects: normalized }, warnings };
}

/** Return whether `cwd` is `root` or one of its descendants. */
export function isWithin(cwd, root, platform = process.platform) {
  const left = pathKey(cwd, platform);
  const right = pathKey(root, platform);
  if (left === right) return true;
  const api = pathApi(platform);
  const prefix = right.endsWith(api.sep) ? right : `${right}${api.sep}`;
  return left.startsWith(prefix);
}

/**
 * Resolve the most specific project policy for one working directory.
 * @param {object | undefined} policy - normalized policy.
 * @param {string} cwd - absolute working directory.
 * @param {string} [platform] - Node platform string.
 * @returns {object | undefined} the winning project, or undefined for no policy.
 */
export function projectForCwd(policy, cwd, platform = process.platform) {
  if (!isRecord(policy) || !Array.isArray(policy.projects) || policy.projects.length === 0) return undefined;
  let normalizedCwd;
  try {
    normalizedCwd = normalizePath(cwd, platform);
  } catch {
    return undefined;
  }
  let winner;
  let winnerLength = -1;
  for (const project of policy.projects) {
    if (!isRecord(project) || typeof project.path !== 'string') continue;
    if (!isWithin(normalizedCwd, project.path, platform)) continue;
    const length = pathKey(project.path, platform).length;
    if (length > winnerLength) {
      winner = project;
      winnerLength = length;
    }
  }
  return winner;
}

/** Return whether a policy project enables one MCP server. */
export function mcpServerEnabled(project, serverName) {
  if (project === undefined) return true;
  if (project.mcp?.mode !== 'selected') return true;
  return Array.isArray(project.mcp.servers) && project.mcp.servers.includes(serverName);
}

/** Return whether a policy project enables one skill. */
export function skillEnabled(project, name) {
  if (project === undefined) return true;
  if (project.skills?.mode !== 'selected') return true;
  return Array.isArray(project.skills.names) && project.skills.names.includes(name);
}

/**
 * Compute the model-facing MCP tools one agent may not use.
 *
 * The resource tools are denied only when a `selected` policy names no
 * enabled server; with any selected server they remain visible and the
 * execution guard filters by their `server` argument.
 *
 * @param {object | undefined} project - winning project.
 * @param {Map<string, readonly string[]> | Record<string, readonly string[]>} toolsByServer
 * @returns {string[]} sorted unique tool names.
 */
export function mcpDenyForProject(project, toolsByServer) {
  if (project === undefined || project.mcp?.mode !== 'selected') return [];
  const selected = new Set(project.mcp.servers ?? []);
  const deny = new Set();
  const entries = toolsByServer instanceof Map ? toolsByServer.entries() : Object.entries(toolsByServer ?? {});
  for (const [serverName, tools] of entries) {
    if (selected.has(serverName)) continue;
    for (const tool of tools) if (!MCP_RESOURCE_TOOLS.includes(tool)) deny.add(tool);
  }
  if (selected.size === 0) for (const tool of MCP_RESOURCE_TOOLS) deny.add(tool);
  return [...deny].sort();
}

/** Return the skill names a policy project suppresses. */
export function skillNamesToDisable(project, names) {
  if (project === undefined || project.skills?.mode !== 'selected') return [];
  const selected = new Set(project.skills.names ?? []);
  const seen = new Set();
  const result = [];
  for (const name of names) {
    if (selected.has(name) || seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }
  return result;
}

/** Strip credentials, query, and fragment from an MCP endpoint URL. */
export function sanitizeUrl(value) {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return undefined;
  }
}
