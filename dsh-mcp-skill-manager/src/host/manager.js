/**
 * Policy enforcement for live agents: MCP tool restrictions, prompt shadows,
 * skill runtime stubs, and execution guards.
 *
 * @module @local/dsh-mcp-skill-manager/host/manager
 */

import {
  MCP_RESOURCE_SECTION,
  MCP_RESOURCE_TOOLS,
  MCP_SECTION_PREFIX,
  MCP_SERVERS_FALLBACK_ORDER,
  MCP_SERVERS_ORDER_NAME,
  SKILL_SOURCE,
  isMcpServerName,
  isSkillName,
  mcpServerOfToolName
} from '../shared/contract.js';
import { canonicalizeProjectPath } from './config-store.js';
import {
  agentCwd,
  discoverServers,
  globalMcpToolNames,
  service
} from './discovery.js';
import {
  mcpDenyForProject,
  mcpServerEnabled,
  normalizePolicy,
  projectForCwd,
  skillNamesToDisable
} from './policy.js';

/** Render the MCP resource server section for one enabled set. */
export function resourceServerText(names) {
  if (names.length === 0) return '';
  return `## MCP resource servers\n\nUse list_mcp_resources, list_mcp_resource_templates, or read_mcp_resource with one of these names as the server argument: ${JSON.stringify(names)}.`;
}

/** Create the per-agent policy manager. */
export function createManager(options) {
  const { ctx, store } = options;
  const logger = options.logger ?? ctx?.logger;
  const platform = store.platform ?? process.platform;
  /** @type {Map<string, object>} */
  const states = new Map();
  const listeners = [];
  let serverCache = null;
  let mcpTimer = null;
  let disposed = false;
  let started = false;
  let suppressTools = 0;
  let suppressSkills = 0;
  let skillsRevision = 0;

  /** Warm the current MCP server/tool snapshot, or reuse it. */
  function getMcpSnapshot() {
    if (serverCache !== null) return serverCache;
    const { servers, loaderAvailable } = discoverServers(ctx);
    const names = servers.map((server) => server.serverName);
    const groups = new Map();
    for (const toolName of globalMcpToolNames(ctx)) {
      const serverName = mcpServerOfToolName(toolName, names);
      if (serverName === undefined) continue;
      const tools = groups.get(serverName) ?? [];
      tools.push(toolName);
      groups.set(serverName, tools);
    }
    serverCache = { servers, names, groups, loaderAvailable };
    return serverCache;
  }

  /** Drop the cached server snapshot. */
  function invalidateMcp() {
    serverCache = null;
  }

  /** Read one agent-scoped service without throwing. */
  function agentService(state, name) {
    return service(state.agent?.ctx, name);
  }

  /** Dispose every prompt shadow owned by one agent state. */
  function disposeSections(state) {
    for (const entry of state.sections.values()) {
      try {
        entry.dispose?.();
      } catch {
        // Disposal is best-effort.
      }
    }
    state.sections.clear();
    state.sectionSignature = '';
  }

  /** Dispose every runtime skill stub owned by one agent state. */
  function disposeStubs(state) {
    for (const dispose of state.stubs.values()) {
      try {
        dispose?.();
      } catch {
        // Disposal is best-effort.
      }
    }
    state.stubs.clear();
  }

  /** Apply the desired restriction, keeping the previous one if registration fails. */
  function applyRestriction(state, deny) {
    const signature = deny.join('\n');
    if (signature === state.denySignature) return;
    if (deny.length === 0) {
      try {
        state.restriction?.();
      } catch {
        // Disposal is best-effort.
      }
      state.restriction = undefined;
      state.denySignature = '';
      return;
    }
    const tools = agentService(state, 'tools');
    if (!tools?.restrict) return;
    suppressTools += 1;
    let next;
    try {
      next = tools.restrict({ deny });
    } catch (error) {
      logger?.warn?.(`mcp-skill-manager: could not restrict tools for one agent: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      suppressTools -= 1;
    }
    if (next === undefined) return;
    const previous = state.restriction;
    state.restriction = next;
    state.denySignature = signature;
    try {
      previous?.();
    } catch {
      // Disposing the superseded restriction is best-effort.
    }
  }

  /** Apply prompt-section shadows for disabled MCP servers and the resource list. */
  function applySections(state, project, snapshot) {
    const systemPrompt = agentService(state, 'systemPrompt');
    if (!systemPrompt?.section) {
      disposeSections(state);
      return;
    }
    const desired = new Map();
    if (project?.mcp?.mode === 'selected') {
      const selected = new Set(project.mcp.servers ?? []);
      for (const server of snapshot.servers) {
        if (!selected.has(server.serverName)) desired.set(`${MCP_SECTION_PREFIX}${server.serverName}`, '');
      }
      const enabled = snapshot.names.filter((name) => selected.has(name)).sort();
      desired.set(MCP_RESOURCE_SECTION, resourceServerText(enabled));
    }
    const signature = JSON.stringify([...desired.entries()].sort(([left], [right]) => left.localeCompare(right)));
    if (signature === state.sectionSignature) return;

    let order = MCP_SERVERS_FALLBACK_ORDER;
    try {
      if (typeof systemPrompt.getSectionOrder === 'function') {
        const value = systemPrompt.getSectionOrder(MCP_SERVERS_ORDER_NAME);
        if (Number.isFinite(value)) order = value;
      }
    } catch {
      // Keep the documented fallback order.
    }

    const next = new Map();
    for (const [name, text] of desired) {
      const previous = state.sections.get(name);
      if (previous !== undefined && previous.text === text) {
        next.set(name, previous);
        continue;
      }
      try {
        const dispose = systemPrompt.section({ name, order, interpolate: false, text });
        next.set(name, { text, dispose });
      } catch (error) {
        logger?.warn?.(`mcp-skill-manager: could not shadow prompt section ${JSON.stringify(name)}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    for (const [name, entry] of state.sections) {
      if (next.get(name) === entry) continue;
      try {
        entry.dispose?.();
      } catch {
        // Disposal is best-effort.
      }
    }
    state.sections = next;
    state.sectionSignature = signature;
  }

  /** Recompute MCP visibility and prompt shadows for one agent. */
  function refreshMcp(state) {
    if (disposed) return;
    const cwd = agentCwd(ctx, state.agent);
    if (cwd !== state.lastCwd) {
      state.lastCwd = cwd;
      state.skillsDirty = true;
    }
    const project = projectForCwd(store.getPolicy(), cwd, platform);
    const snapshot = getMcpSnapshot();
    applyRestriction(state, mcpDenyForProject(project, snapshot.groups));
    applySections(state, project, snapshot);
  }

  /** Rebuild the runtime stubs for one agent from its current catalog. */
  async function rebuildSkills(state, signal) {
    const skills = agentService(state, 'skills');
    if (!skills?.snapshot || !skills?.register) {
      state.skillsDirty = true;
      return;
    }
    const revision = skillsRevision;
    suppressSkills += 1;
    try {
      // Snapshot before changing registrations: if discovery fails, the
      // previous stubs stay in place instead of exposing disabled skills.
      const snapshot = await skills.snapshot({ cwd: state.lastCwd, scope: state.agent, signal });
      if (signal?.aborted === true) throw signal.reason instanceof Error ? signal.reason : new Error('aborted');
      const project = projectForCwd(store.getPolicy(), state.lastCwd, platform);
      const summaries = Array.isArray(snapshot?.skills) ? snapshot.skills : [];
      const names = summaries.map((skill) => skill.name);
      const disabled = new Set(skillNamesToDisable(project, names));
      const byName = new Map();
      for (const summary of summaries) if (!byName.has(summary.name)) byName.set(summary.name, summary);
      for (const name of disabled) {
        if (state.stubs.has(name)) continue;
        const summary = byName.get(name);
        if (summary === undefined) continue;
        try {
          const dispose = skills.register({
            name: summary.name,
            description: typeof summary.description === 'string' && summary.description.length > 0 ? summary.description : summary.name,
            ...(summary.whenToUse === undefined ? {} : { whenToUse: summary.whenToUse }),
            content: '',
            source: SKILL_SOURCE,
            invocation: { modelInvocable: false, userInvocable: false }
          });
          state.stubs.set(summary.name, dispose);
        } catch (error) {
          logger?.warn?.(`mcp-skill-manager: could not suppress skill ${JSON.stringify(summary.name)}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      for (const [name, dispose] of [...state.stubs]) {
        if (disabled.has(name)) continue;
        try {
          dispose?.();
        } catch {
          // Disposal is best-effort.
        }
        state.stubs.delete(name);
      }
      state.skillsDirty = snapshot?.complete === false || revision !== skillsRevision;
    } catch (error) {
      state.skillsDirty = true;
      throw error;
    } finally {
      suppressSkills -= 1;
    }
  }

  /** Rebuild skills once per agent while reusing an in-flight rebuild. */
  function ensureSkillsFresh(state, signal, options2 = {}) {
    if (disposed) return Promise.resolve();
    if (state.skillsPromise !== undefined) return state.skillsPromise;
    if (options2.force !== true && state.skillsDirty !== true) return Promise.resolve();
    const promise = rebuildSkills(state, signal).finally(() => {
      state.skillsPromise = undefined;
    });
    state.skillsPromise = promise;
    return promise;
  }

  /** Pre-step barrier: refresh before tool-skill publishes its catalog. */
  async function ensureBeforeStep(state, payload, next) {
    try {
      const cwd = agentCwd(ctx, state.agent);
      if (cwd !== state.lastCwd) {
        state.lastCwd = cwd;
        state.skillsDirty = true;
      }
      refreshMcp(state);
      await ensureSkillsFresh(state, payload?.signal);
    } catch (error) {
      if (payload?.signal?.aborted !== true) {
        logger?.warn?.(`mcp-skill-manager: policy refresh before step failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return next();
  }

  /** Register one live agent and apply the current policy. */
  async function attach(agent, options2 = {}) {
    if (disposed || agent === undefined) return;
    let state = states.get(agent.id);
    if (state === undefined) {
      state = {
        agent,
        lastCwd: agentCwd(ctx, agent),
        restriction: undefined,
        denySignature: '',
        sections: new Map(),
        sectionSignature: '',
        stubs: new Map(),
        skillsDirty: true,
        skillsPromise: undefined,
        preStepDispose: undefined
      };
      states.set(agent.id, state);
      try {
        const on = agent.ctx?.on;
        if (typeof on === 'function') {
          state.preStepDispose = on('agent/pre-step', (payload, next) => ensureBeforeStep(state, payload, next), { prepend: true });
        }
      } catch (error) {
        logger?.warn?.(`mcp-skill-manager: could not register the pre-step refresh: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    refreshMcp(state);
    if (options2.rebuild !== false) {
      try {
        await ensureSkillsFresh(state, undefined, { force: true });
      } catch (error) {
        logger?.warn?.(`mcp-skill-manager: could not apply skill policy to one agent: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /** Release one agent's bookkeeping. Agent-scoped effects already unwind on disposal. */
  function detach(agent) {
    const state = states.get(agent?.id);
    if (state === undefined) return;
    states.delete(agent.id);
    try {
      state.preStepDispose?.();
    } catch {
      // Disposal is best-effort.
    }
    try {
      state.restriction?.();
    } catch {
      // Disposal is best-effort.
    }
    disposeSections(state);
    disposeStubs(state);
  }

  /** Handle a committed working-directory transition. */
  function onSessionEvent(session, event) {
    if (disposed || event?.type !== 'working-directory/change') return;
    const cwd = event.data?.cwd;
    if (typeof cwd !== 'string') return;
    const agents = service(ctx, 'agents');
    let agent;
    try {
      agent = agents?.get?.(session?.id);
    } catch {
      agent = undefined;
    }
    const state = states.get(agent?.id ?? session?.id);
    if (state === undefined) return;
    state.lastCwd = cwd;
    state.skillsDirty = true;
    refreshMcp(state);
    ensureSkillsFresh(state, undefined).catch((error) => {
      if (disposed) return;
      logger?.warn?.(`mcp-skill-manager: could not refresh skills after a directory change: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  /** Coalesce tool-registry changes before recomputing every agent. */
  function scheduleMcpRefresh() {
    if (disposed || suppressTools > 0 || mcpTimer !== null) return;
    mcpTimer = setTimeout(() => {
      mcpTimer = null;
      invalidateMcp();
      for (const state of states.values()) refreshMcp(state);
    }, 0);
    mcpTimer.unref?.();
  }

  /** Mark every agent's skill catalog stale; the next pre-step rebuilds it. */
  function onSkillsChanged() {
    skillsRevision += 1;
    if (disposed || suppressSkills > 0) return;
    for (const state of states.values()) state.skillsDirty = true;
  }

  /** Deny one model call that the current project policy disallows. */
  function guard(exec) {
    try {
      const agent = exec?.agent;
      if (agent === undefined || agent === null) return undefined;
      const state = states.get(agent.id);
      const cwd = state?.lastCwd ?? agentCwd(ctx, agent);
      const project = projectForCwd(store.getPolicy(), cwd, platform);
      if (project === undefined) return undefined;
      const name = exec.name;
      if (name === 'skill') {
        const skill = exec.arguments?.name;
        if (isSkillName(skill) && project.skills?.mode === 'selected' && !project.skills.names.includes(skill)) {
          return `MCP/Skill policy blocks skill "${skill}" for this project directory.`;
        }
        return undefined;
      }
      if (MCP_RESOURCE_TOOLS.includes(name)) {
        const server = exec.arguments?.server;
        if (isMcpServerName(server) && !mcpServerEnabled(project, server)) {
          return `MCP/Skill policy blocks MCP server "${server}" for this project directory.`;
        }
        return undefined;
      }
      const serverName = mcpServerOfToolName(name, getMcpSnapshot().names);
      if (serverName !== undefined && !mcpServerEnabled(project, serverName)) {
        return `MCP/Skill policy blocks MCP server "${serverName}" for this project directory.`;
      }
    } catch (error) {
      logger?.warn?.(`mcp-skill-manager: tool guard failed open: ${error instanceof Error ? error.message : String(error)}`);
    }
    return undefined;
  }

  /** Start listeners, the guard, and policy application for existing agents. */
  async function start() {
    if (started || disposed) return;
    started = true;
    const tools = service(ctx, 'tools');
    if (tools?.guard) {
      try {
        listeners.push(tools.guard((exec) => guard(exec)));
      } catch (error) {
        logger?.warn?.(`mcp-skill-manager: could not register the tool guard: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    try {
      listeners.push(ctx.on('agent/created', (payload) => attach(payload?.agent).catch((error) => {
        logger?.warn?.(`mcp-skill-manager: could not attach policy to a new agent: ${error instanceof Error ? error.message : String(error)}`);
      })));
      listeners.push(ctx.on('agent/disposed', (payload) => detach(payload?.agent)));
      listeners.push(ctx.on('session/event', (session, event) => onSessionEvent(session, event)));
      listeners.push(ctx.on('tools/change', () => scheduleMcpRefresh()));
      listeners.push(ctx.on('skills/change', () => onSkillsChanged()));
      listeners.push(ctx.on('loader/config-update', () => {
        invalidateMcp();
        scheduleMcpRefresh();
      }));
    } catch (error) {
      logger?.warn?.(`mcp-skill-manager: could not register host listeners: ${error instanceof Error ? error.message : String(error)}`);
    }
    const agents = service(ctx, 'agents');
    let list = [];
    try {
      list = agents?.list?.() ?? [];
    } catch {
      list = [];
    }
    await Promise.all(list.map((agent) => attach(agent).catch((error) => {
      logger?.warn?.(`mcp-skill-manager: could not apply policy to a live agent: ${error instanceof Error ? error.message : String(error)}`);
    })));
  }

  /** Flush pending MCP refreshes and skill rebuilds (tests and explicit refresh). */
  async function flush() {
    if (mcpTimer !== null) {
      clearTimeout(mcpTimer);
      mcpTimer = null;
      invalidateMcp();
      for (const state of states.values()) refreshMcp(state);
    }
    for (const state of states.values()) {
      try {
        await ensureSkillsFresh(state, undefined);
      } catch (error) {
        logger?.warn?.(`mcp-skill-manager: pending skill refresh failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /** Validate, persist, and apply one complete policy document. */
  async function savePolicy(input) {
    const normalized = normalizePolicy(input, {
      platform,
      canonicalize: (value) => canonicalizeProjectPath(value, platform)
    });
    await store.write(normalized.policy);
    invalidateMcp();
    const warnings = [...normalized.warnings];
    for (const state of states.values()) {
      refreshMcp(state);
      state.skillsDirty = true;
      try {
        await ensureSkillsFresh(state, undefined, { force: true });
      } catch (error) {
        warnings.push({
          code: 'apply-failed',
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return { policy: normalized.policy, warnings };
  }

  /** Remove every effect the plugin owns outside its own Cordis fiber. */
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (mcpTimer !== null) {
      clearTimeout(mcpTimer);
      mcpTimer = null;
    }
    for (const state of states.values()) {
      try {
        state.restriction?.();
      } catch {
        // Disposal is best-effort.
      }
      disposeSections(state);
      disposeStubs(state);
      try {
        state.preStepDispose?.();
      } catch {
        // Disposal is best-effort.
      }
    }
    states.clear();
    for (const disposeListener of listeners.splice(0)) {
      try {
        disposeListener?.();
      } catch {
        // Disposal is best-effort.
      }
    }
    serverCache = null;
  }

  return {
    start,
    attach,
    detach,
    flush,
    savePolicy,
    dispose,
    guard,
    getMcpSnapshot,
    invalidateMcp,
    states,
    get disposed() {
      return disposed;
    }
  };
}
