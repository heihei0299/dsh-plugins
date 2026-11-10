/**
 * Pure draft operations for the MCP & Skill panel.
 *
 * Every function returns new objects; the container owns React state.
 *
 * @module @local/dsh-mcp-skill-manager/client/model
 */

import { LABEL_LIMIT, PATH_LIMIT } from '../shared/contract.js';

/** Client-side validation failure. */
export class ModelError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ModelError';
    this.code = code;
  }
}

/** Deep clone one JSON-shaped policy. */
export function clonePolicy(policy) {
  return JSON.parse(JSON.stringify(policy));
}

/** Return whether a string is an absolute POSIX or Windows path. */
export function isAbsolutePath(value) {
  if (typeof value !== 'string') return false;
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value);
}

/** Last path segment, or the whole path for a filesystem root. */
export function basenamePath(value) {
  const original = String(value);
  const trimmed = original.replace(/[\\/]+$/, '');
  if (trimmed.length === 0) return original;
  if (/^[A-Za-z]:$/.test(trimmed)) return `${trimmed}${original.includes('\\') ? '\\' : '/'}`;
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return index >= 0 ? trimmed.slice(index + 1) || trimmed : trimmed;
}

/** Create one project entry with everything enabled. */
export function defaultProject(projectPath, label) {
  return {
    path: projectPath,
    label: label === undefined ? basenamePath(projectPath) : label,
    mcp: { mode: 'all', servers: [] },
    skills: { mode: 'all', names: [] }
  };
}

/** Find one project by its stored path. */
export function findProject(policy, projectPath) {
  return policy?.projects?.find((project) => project.path === projectPath);
}

/** Replace one project immutably. */
export function updateProject(policy, projectPath, updater) {
  return {
    ...policy,
    projects: policy.projects.map((project) => (project.path === projectPath ? updater(clonePolicy(project)) : project))
  };
}

/**
 * Add a project directory to the draft.
 * @returns {{ policy: object, project: object }}
 * @throws {ModelError} when the path is missing, relative, or duplicated.
 */
export function addProject(policy, rawPath, label) {
  const projectPath = typeof rawPath === 'string' ? rawPath.trim() : '';
  if (projectPath.length === 0) throw new ModelError('path-required', 'Enter an absolute directory path');
  if (projectPath.includes('\0')) throw new ModelError('path-invalid', 'The path must not contain NUL');
  if (projectPath.length > PATH_LIMIT) throw new ModelError('path-invalid', `The path must be at most ${PATH_LIMIT} characters`);
  if (!isAbsolutePath(projectPath)) throw new ModelError('path-absolute', 'The path must be absolute');
  if (policy.projects.some((project) => project.path === projectPath)) {
    throw new ModelError('duplicate', 'That directory already has a policy');
  }
  const cleanedLabel = typeof label === 'string' ? label.trim().slice(0, LABEL_LIMIT) : '';
  const project = defaultProject(projectPath, cleanedLabel.length > 0 ? cleanedLabel : undefined);
  return { policy: { ...policy, projects: [...policy.projects, project] }, project };
}

/** Remove one project directory from the draft. */
export function removeProject(policy, projectPath) {
  return { ...policy, projects: policy.projects.filter((project) => project.path !== projectPath) };
}

/** Update one display label. */
export function updateLabel(policy, projectPath, label) {
  return updateProject(policy, projectPath, (project) => ({ ...project, label }));
}

/** Known server names from the host snapshot and the saved allowlist. */
export function knownServers(project, servers) {
  const names = new Set();
  for (const server of servers ?? []) {
    if (typeof server === 'string') names.add(server);
    else if (typeof server?.serverName === 'string') names.add(server.serverName);
  }
  for (const name of project?.mcp?.servers ?? []) names.add(name);
  return [...names].sort();
}

/** Known skill names from the current catalog and the saved allowlist. */
export function knownSkills(project, catalog) {
  const names = new Set();
  for (const skill of catalog ?? []) {
    if (typeof skill === 'string') names.add(skill);
    else if (typeof skill?.name === 'string') names.add(skill.name);
  }
  for (const name of project?.skills?.names ?? []) names.add(name);
  return [...names].sort();
}

/** Switch the MCP mode, preserving the current effective selection. */
export function setMcpMode(project, mode, known) {
  if (mode === 'all') return { ...project, mcp: { ...project.mcp, mode: 'all' } };
  if (mode !== 'selected') return project;
  const servers = project.mcp.mode === 'all' ? [...new Set(known ?? [])].sort() : [...new Set(project.mcp.servers ?? [])].sort();
  return { ...project, mcp: { mode: 'selected', servers } };
}

/** Toggle one MCP server, switching from All to Selected on the first uncheck. */
export function toggleMcpServer(project, serverName, known) {
  if (project.mcp.mode === 'all') {
    const selected = new Set(known ?? []);
    selected.delete(serverName);
    return { ...project, mcp: { mode: 'selected', servers: [...selected].sort() } };
  }
  const selected = new Set(project.mcp.servers ?? []);
  if (selected.has(serverName)) selected.delete(serverName);
  else selected.add(serverName);
  return { ...project, mcp: { ...project.mcp, servers: [...selected].sort() } };
}

/** Switch the skill mode, preserving the current effective selection. */
export function setSkillMode(project, mode, known) {
  if (mode === 'all') return { ...project, skills: { ...project.skills, mode: 'all' } };
  if (mode !== 'selected') return project;
  const names = project.skills.mode === 'all' ? [...new Set(known ?? [])].sort() : [...new Set(project.skills.names ?? [])].sort();
  return { ...project, skills: { mode: 'selected', names } };
}

/** Toggle one skill, switching from All to Selected on the first uncheck. */
export function toggleSkill(project, name, known) {
  if (project.skills.mode === 'all') {
    const selected = new Set(known ?? []);
    selected.delete(name);
    return { ...project, skills: { mode: 'selected', names: [...selected].sort() } };
  }
  const selected = new Set(project.skills.names ?? []);
  if (selected.has(name)) selected.delete(name);
  else selected.add(name);
  return { ...project, skills: { ...project.skills, names: [...selected].sort() } };
}

/** Stable comparison for dirty tracking. */
export function policySignature(policy) {
  return JSON.stringify(policy);
}
