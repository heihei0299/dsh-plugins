/**
 * dsh-go policy panel controller.
 *
 * The host owns policy and discovery; this module adapts them to the native
 * panel protocol: a bounded data object, declarative actions, and deferred
 * saves that never claim success before the policy file is written.
 *
 * @module @local/dsh-mcp-skill-manager/dsh-go/panel
 */

import path from 'node:path';
import { canonicalizeProjectPath } from '../../src/host/config-store.js';
import { agentCwd, discoverServers, discoverSkills, service } from '../../src/host/discovery.js';
import {
  projectForCwd,
  mcpServerEnabled,
  skillEnabled,
  normalizePath
} from '../../src/host/policy.js';
import { isMcpServerName, isSkillName } from '../../src/shared/contract.js';
import { buildView } from './view.js';
import { charLength, tr } from './text.js';

const MAX_PROJECT_ROWS = 12;
const MAX_SERVER_ROWS = 20;
const MAX_SKILL_ROWS = 20;
const MAX_STALE_ROWS = 10;
const MAX_TEXT = 160;
const MAX_NOTICE = 240;
const MAX_TOAST = 40;

function truncate(value, limit = MAX_TEXT) {
  const text = typeof value === 'string' ? value : String(value ?? '');
  if (charLength(text) <= limit) return text;
  return `${[...text].slice(0, Math.max(1, limit - 1)).join('')}…`;
}

function toast(locale, message) {
  return truncate(message, MAX_TOAST);
}

function defaultProject(projectPath) {
  return {
    path: projectPath,
    label: path.basename(projectPath) || projectPath,
    mcp: { mode: 'all', servers: [] },
    skills: { mode: 'all', names: [] }
  };
}

function clonePolicy(policy) {
  return {
    version: policy.version,
    projects: (policy.projects ?? []).map((project) => ({
      path: project.path,
      label: project.label,
      mcp: { mode: project.mcp?.mode ?? 'all', servers: [...(project.mcp?.servers ?? [])] },
      skills: { mode: project.skills?.mode ?? 'all', names: [...(project.skills?.names ?? [])] }
    }))
  };
}

function findProjectIndex(policy, projectPath) {
  if (typeof projectPath !== 'string') return -1;
  return (policy.projects ?? []).findIndex((project) => project.path === projectPath);
}

function selectedProject(state) {
  return (state.policy.projects ?? []).find((project) => project.path === state.selectedPath);
}

function effectiveProject(state) {
  const exact = selectedProject(state);
  if (exact !== undefined) return exact;
  if (state.currentCwd) {
    const matching = projectForCwd(state.policy, state.currentCwd, state.platform);
    if (matching !== undefined) return matching;
  }
  return state.policy.projects?.[0];
}

function resolveCurrentCwd(ctx, scope) {
  if (typeof scope?.sessionId !== 'string' || scope.sessionId.length === 0) return undefined;
  try {
    const agent = service(ctx, 'agents')?.get?.(scope.sessionId);
    if (agent === undefined) return undefined;
    const cwd = agentCwd(ctx, agent);
    if (typeof cwd === 'string' && cwd.length > 0) return cwd;
    return undefined;
  } catch {
    return undefined;
  }
}

function unique(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (typeof value !== 'string' || value.length === 0 || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function projectRows(state, locale) {
  const projects = state.policy.projects ?? [];
  const selected = projects.findIndex((project) => project.path === state.selectedPath);
  let indexes = projects.map((_, index) => index);
  if (indexes.length > MAX_PROJECT_ROWS) {
    if (selected >= MAX_PROJECT_ROWS) {
      indexes = [selected, ...indexes.filter((index) => index !== selected).slice(0, MAX_PROJECT_ROWS - 1)];
    } else {
      indexes = indexes.slice(0, MAX_PROJECT_ROWS);
    }
  }
  return indexes.map((index) => {
    const project = projects[index];
    return {
      title: truncate(project.label, 60),
      subtitle: truncate(project.path, 180),
      trailing: project.path === state.selectedPath ? '✓' : '',
      icon: 'folder',
      action: { id: 'select-project', args: { index } }
    };
  });
}

function knownNames(project, discovered, field) {
  return unique([
    ...discovered,
    ...((field === 'mcp' ? project?.mcp?.servers : project?.skills?.names) ?? [])
  ]);
}

function serverRows(state, project, locale) {
  const rows = (state.catalog.servers ?? []).slice(0, MAX_SERVER_ROWS).map((server) => {
    const enabled = mcpServerEnabled(project, server.serverName);
    const detail = [server.transport, `${server.toolCount} tools`].filter(Boolean).join(' · ');
    return {
      title: server.serverName,
      subtitle: truncate(detail, 80),
      trailing: server.disabled ? tr(locale, 'mcp.hostDisabled') : enabled ? 'ON' : 'OFF',
      tone: server.disabled ? 'warn' : enabled ? 'good' : 'neutral',
      action: { id: 'toggle-mcp', args: { name: server.serverName } }
    };
  });
  if (rows.length === 0) return [];
  return rows;
}

function skillRows(state, project, locale) {
  return (state.catalog.skills ?? []).slice(0, MAX_SKILL_ROWS).map((skill) => {
    const enabled = skillEnabled(project, skill.name);
    const nativeDisabled = skill.modelInvocable === false && skill.userInvocable === false;
    return {
      title: skill.name,
      subtitle: truncate(skill.description ?? '', 100),
      trailing: nativeDisabled ? tr(locale, 'skills.nativeDisabled') : enabled ? 'ON' : 'OFF',
      tone: nativeDisabled ? 'warn' : enabled ? 'good' : 'neutral',
      action: { id: 'toggle-skill', args: { name: skill.name } }
    };
  });
}

function staleRows(state, project, locale) {
  if (project === undefined) return [];
  const rows = [];
  if (project.mcp?.mode === 'selected') {
    const known = new Set((state.catalog.servers ?? []).map((server) => server.serverName));
    for (const name of project.mcp.servers ?? []) {
      if (!known.has(name)) {
        rows.push({
          title: name,
          subtitle: tr(locale, 'mcp.stale'),
          trailing: tr(locale, 'action.remove'),
          tone: 'warn',
          action: { id: 'remove-stale', args: { kind: 'mcp', name } }
        });
      }
    }
  }
  if (project.skills?.mode === 'selected') {
    const known = new Set((state.catalog.skills ?? []).map((skill) => skill.name));
    for (const name of project.skills.names ?? []) {
      if (!known.has(name)) {
        rows.push({
          title: name,
          subtitle: tr(locale, 'skills.stale'),
          trailing: tr(locale, 'action.remove'),
          tone: 'warn',
          action: { id: 'remove-stale', args: { kind: 'skill', name } }
        });
      }
    }
  }
  return rows.slice(0, MAX_STALE_ROWS);
}

function noticeFor(state, locale) {
  if (state.configError) return tr(locale, 'notice.configError', { message: truncate(state.configError, MAX_NOTICE - 20) });
  if (state.warning) return tr(locale, 'notice.warning', { message: truncate(state.warning, MAX_NOTICE) });
  if (state.loading) return tr(locale, 'notice.loading');
  if (state.catalog.unavailable) return tr(locale, 'notice.skillsUnavailable');
  if (state.saved) return tr(locale, 'notice.saved');
  return tr(locale, 'notice.autoSave');
}

/**
 * Build one bounded native data object.
 *
 * @param {object} state - panel state.
 * @param {string} [locale] - current app locale.
 */
export function buildData(state, locale = state.locale) {
  const project = effectiveProject(state);
  const servers = state.catalog.servers ?? [];
  const skills = state.catalog.skills ?? [];
  const allServers = knownNames(project, servers.map((server) => server.serverName), 'mcp');
  const allSkills = knownNames(project, skills.map((skill) => skill.name), 'skill');
  const enabledServers = allServers.filter((name) => mcpServerEnabled(project, name)).length;
  const enabledSkills = allSkills.filter((name) => skillEnabled(project, name)).length;
  const summary = project === undefined
    ? (state.policy.projects?.length ? tr(locale, 'summary.none') : tr(locale, 'projects.empty'))
    : `${project.label} · ${project.path}`;
  const status = state.configError
    ? tr(locale, 'stats.error')
    : state.loading
      ? tr(locale, 'status.loading')
      : state.saved
        ? tr(locale, 'status.saved')
        : tr(locale, 'stats.loaded');

  const rows = projectRows(state, locale);
  const stale = staleRows(state, project, locale);
  return {
    projects: rows,
    projectRows: rows,
    selectedPath: state.selectedPath ?? '',
    summary: truncate(summary, 220),
    stats: [
      { label: tr(locale, 'stats.file'), value: truncate(state.store.displayFile, 180) },
      { label: tr(locale, 'stats.cwd'), value: truncate(state.currentCwd ?? '—', 180) },
      { label: tr(locale, 'stats.mcp'), value: tr(locale, 'stats.enabled', { on: enabledServers, total: allServers.length }) },
      { label: tr(locale, 'stats.skills'), value: tr(locale, 'stats.enabled', { on: enabledSkills, total: allSkills.length }) },
      { label: tr(locale, 'stats.status'), value: status }
    ],
    mcpMode: project?.mcp?.mode ?? 'all',
    skillMode: project?.skills?.mode ?? 'all',
    serverRows: serverRows(state, project, locale),
    skillRows: skillRows(state, project, locale),
    staleRows: stale,
    notice: noticeFor(state, locale),
    form: { path: state.form.path, label: state.form.label },
    loading: state.loading,
    unavailable: Boolean(state.catalog.unavailable)
  };
}

/**
 * Create the panel controller registered as `ctx.dshGo.panel('policy', ...)`.
 *
 * @param {{ctx: object, manager: object, store: object, logger?: object}} options
 */
export function createDshGoPanel({ ctx, manager, store, logger }) {
  const states = new Map();
  const platform = store.platform ?? process.platform;

  function stateKey(scope) {
    return typeof scope?.sessionId === 'string' && scope.sessionId.length > 0 ? scope.sessionId : 'features';
  }

  function emitState(state) {
    if (typeof state.emit !== 'function' || state.disposed) return;
    try {
      state.emit(buildData(state, state.locale));
    } catch (error) {
      logger?.warn?.(`mcp-skill-manager: dsh-go data emit failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function disposeState(state) {
    if (state.disposed) return;
    state.disposed = true;
    try {
      state.abort?.abort();
    } catch {
      // Best-effort cancellation.
    }
    states.delete(state.key);
  }

  function ensureState(scope, caps) {
    const key = stateKey(scope);
    let state = states.get(key);
    if (state !== undefined) {
      state.locale = caps?.locale ?? state.locale;
      return state;
    }
    const policy = store.getPolicy();
    const currentCwd = resolveCurrentCwd(ctx, scope);
    const matching = currentCwd ? projectForCwd(policy, currentCwd, platform) : undefined;
    const selectedPath = matching?.path ?? policy.projects?.[0]?.path ?? null;
    const error = store.getError();
    state = {
      key,
      ctx,
      manager,
      store,
      platform,
      policy,
      currentCwd,
      selectedPath,
      locale: caps?.locale ?? 'zh',
      form: { path: '', label: '' },
      catalog: { servers: [], skills: [], unavailable: false, complete: true, warning: undefined, loaderAvailable: false },
      loading: false,
      loadingPromise: null,
      token: 0,
      abort: null,
      emit: null,
      feeds: 0,
      configError: error?.message ?? null,
      warning: store.getWarnings?.()?.[0]?.message ?? undefined,
      saved: false,
      disposed: false
    };
    states.set(key, state);
    return state;
  }

  async function refreshCatalog(state, { force = false } = {}) {
    if (state.disposed) return;
    if (state.loadingPromise !== null && !force) return state.loadingPromise;
    if (state.loadingPromise !== null && force) {
      try {
        state.abort?.abort();
      } catch {
        // Best-effort cancellation.
      }
    }
    const token = ++state.token;
    const abort = new AbortController();
    state.abort = abort;
    state.loading = true;
    emitState(state);

    const task = (async () => {
      let warning = state.catalog.warning;
      let servers = [];
      let loaderAvailable = false;
      try {
        const discovered = discoverServers(ctx);
        servers = discovered.servers ?? [];
        loaderAvailable = discovered.loaderAvailable === true;
        warning = undefined;
      } catch (error) {
        warning = error instanceof Error ? error.message : String(error);
      }

      let skills = [];
      let unavailable = false;
      let complete = true;
      const cwd = state.selectedPath ?? state.currentCwd;
      if (cwd) {
        try {
          const discovered = await discoverSkills(ctx, cwd, abort.signal);
          skills = discovered.skills ?? [];
          unavailable = discovered.unavailable === true;
          complete = discovered.complete !== false;
          if (discovered.warning) warning = discovered.warning;
        } catch (error) {
          if (!abort.signal.aborted) warning = error instanceof Error ? error.message : String(error);
        }
      }

      if (state.disposed || token !== state.token) return;
      state.catalog = { servers, skills, unavailable, complete, warning, loaderAvailable };
      state.loading = false;
      state.loadingPromise = null;
      if (warning) state.warning = warning;
      emitState(state);
    })();

    state.loadingPromise = task;
    try {
      await task;
    } finally {
      if (token === state.token) state.loadingPromise = null;
    }
    return task;
  }

  async function saveAndPatch(state, nextPolicy, successMessage) {
    state.loading = true;
    state.saved = false;
    emitState(state);
    try {
      const result = await manager.savePolicy(nextPolicy);
      state.policy = result.policy;
      state.configError = null;
      state.warning = result.warnings?.[0]?.message;
      state.selectedPath = findProjectIndex(state.policy, state.selectedPath) >= 0
        ? state.selectedPath
        : state.policy.projects?.[0]?.path ?? null;
      state.saved = true;
      void refreshCatalog(state, { force: true });
      const message = successMessage ?? tr(state.locale, 'notice.saved');
      state.warning = result.warnings?.[0]?.message;
      return { toast: toast(state.locale, message), patch: buildData(state, state.locale) };
    } catch (error) {
      state.loading = false;
      const message = error instanceof Error ? error.message : String(error);
      state.warning = message;
      emitState(state);
      return { toast: toast(state.locale, tr(state.locale, 'notice.saveFailed', { message })), patch: buildData(state, state.locale) };
    }
  }

  function currentIndex(state) {
    return findProjectIndex(state.policy, state.selectedPath);
  }

  function actionState(scope, event) {
    const state = ensureState(scope, { locale: event?.locale });
    state.locale = event?.locale ?? state.locale;
    return state;
  }

  function deferredSave(state, nextPolicy, successMessage) {
    return {
      pending: { label: tr(state.locale, 'status.saving'), timeoutMs: 30_000 },
      result: async (signal) => {
        if (signal?.aborted) return { patch: buildData(state, state.locale) };
        return saveAndPatch(state, nextPolicy, successMessage);
      }
    };
  }

  function addProject(state, rawPath, rawLabel) {
    let normalized;
    try {
      normalized = normalizePath(String(rawPath ?? '').trim(), platform);
    } catch (error) {
      return { toast: toast(state.locale, tr(state.locale, 'notice.invalidPath')), patch: buildData(state, state.locale) };
    }
    if ((state.policy.projects?.length ?? 0) >= 200) {
      return { toast: toast(state.locale, tr(state.locale, 'notice.saveFailed', { message: 'project limit' })) };
    }
    let canonical;
    try {
      canonical = canonicalizeProjectPath(normalized, platform);
    } catch (error) {
      return { toast: toast(state.locale, tr(state.locale, 'notice.invalidPath')), patch: buildData(state, state.locale) };
    }
    if (canonical.exists === true && canonical.directory === false) {
      return { toast: toast(state.locale, tr(state.locale, 'notice.invalidPath')), patch: buildData(state, state.locale) };
    }
    const projectPath = normalizePath(canonical.path, platform);
    if (findProjectIndex(state.policy, projectPath) >= 0) {
      return { toast: toast(state.locale, tr(state.locale, 'notice.duplicate')), patch: buildData(state, state.locale) };
    }
    const label = typeof rawLabel === 'string' ? rawLabel.trim() : '';
    const next = clonePolicy(state.policy);
    const project = defaultProject(projectPath);
    if (label.length > 0) project.label = label.slice(0, 120);
    next.projects.push(project);
    state.selectedPath = projectPath;
    state.form = { path: '', label: '' };
    return deferredSave(state, next);
  }

  function removeSelected(state) {
    const index = currentIndex(state);
    if (index < 0) return { patch: buildData(state, state.locale) };
    const next = clonePolicy(state.policy);
    next.projects.splice(index, 1);
    state.selectedPath = next.projects[index]?.path ?? next.projects[index - 1]?.path ?? null;
    return deferredSave(state, next, tr(state.locale, 'notice.saved'));
  }

  function patchFor(state) {
    return { patch: buildData(state, state.locale) };
  }

  const actions = {
    'select-project': (scope, event) => {
      const state = actionState(scope, event);
      const index = Number(event?.value?.index);
      const project = Number.isInteger(index) ? state.policy.projects?.[index] : undefined;
      if (project === undefined) return patchFor(state);
      state.selectedPath = project.path;
      state.saved = false;
      void refreshCatalog(state, { force: true });
      return patchFor(state);
    },

    'add-project': (scope, event) => {
      const state = actionState(scope, event);
      const values = event?.value?.values ?? {};
      const rawPath = values['data.form.path'] ?? state.form.path;
      const rawLabel = values['data.form.label'] ?? state.form.label;
      return addProject(state, rawPath, rawLabel);
    },

    'add-current': (scope, event) => {
      const state = actionState(scope, event);
      if (!state.currentCwd) {
        return { toast: toast(state.locale, tr(state.locale, 'notice.noCwd')), ...patchFor(state) };
      }
      const existing = projectForCwd(state.policy, state.currentCwd, platform);
      if (existing !== undefined) {
        state.selectedPath = existing.path;
        void refreshCatalog(state, { force: true });
        return patchFor(state);
      }
      return addProject(state, state.currentCwd, path.basename(state.currentCwd) || undefined);
    },

    'remove-project': (scope, event) => {
      const state = actionState(scope, event);
      if (event?.value?.confirmed !== true) {
        return { toast: toast(state.locale, tr(state.locale, 'action.cancel')) };
      }
      return removeSelected(state);
    },

    'mcp-mode': (scope, event) => {
      const state = actionState(scope, event);
      const index = currentIndex(state);
      if (index < 0) return { toast: toast(state.locale, tr(state.locale, 'notice.addFirst')) };
      const mode = event?.value?.value;
      if (mode !== 'all' && mode !== 'selected') return patchFor(state);
      const next = clonePolicy(state.policy);
      next.projects[index].mcp.mode = mode;
      return deferredSave(state, next);
    },

    'skill-mode': (scope, event) => {
      const state = actionState(scope, event);
      const index = currentIndex(state);
      if (index < 0) return { toast: toast(state.locale, tr(state.locale, 'notice.addFirst')) };
      const mode = event?.value?.value;
      if (mode !== 'all' && mode !== 'selected') return patchFor(state);
      const next = clonePolicy(state.policy);
      next.projects[index].skills.mode = mode;
      return deferredSave(state, next);
    },

    'toggle-mcp': (scope, event) => {
      const state = actionState(scope, event);
      const index = currentIndex(state);
      if (index < 0) return { toast: toast(state.locale, tr(state.locale, 'notice.addFirst')) };
      const name = event?.value?.name;
      if (!isMcpServerName(name)) return patchFor(state);
      const project = state.policy.projects[index];
      const next = clonePolicy(state.policy);
      const target = next.projects[index];
      if (project.mcp.mode !== 'selected') {
        target.mcp.mode = 'selected';
        const names = knownNames(project, state.catalog.servers.map((server) => server.serverName), 'mcp');
        target.mcp.servers = names.filter((item) => item !== name);
      } else if (target.mcp.servers.includes(name)) {
        target.mcp.servers = target.mcp.servers.filter((item) => item !== name);
      } else {
        target.mcp.servers.push(name);
      }
      return deferredSave(state, next);
    },

    'toggle-skill': (scope, event) => {
      const state = actionState(scope, event);
      const index = currentIndex(state);
      if (index < 0) return { toast: toast(state.locale, tr(state.locale, 'notice.addFirst')) };
      const name = event?.value?.name;
      if (!isSkillName(name)) return patchFor(state);
      const project = state.policy.projects[index];
      const next = clonePolicy(state.policy);
      const target = next.projects[index];
      if (project.skills.mode !== 'selected') {
        target.skills.mode = 'selected';
        const names = knownNames(project, state.catalog.skills.map((skill) => skill.name), 'skill');
        target.skills.names = names.filter((item) => item !== name);
      } else if (target.skills.names.includes(name)) {
        target.skills.names = target.skills.names.filter((item) => item !== name);
      } else {
        target.skills.names.push(name);
      }
      return deferredSave(state, next);
    },

    'remove-stale': (scope, event) => {
      const state = actionState(scope, event);
      const index = currentIndex(state);
      if (index < 0) return patchFor(state);
      const kind = event?.value?.kind;
      const name = event?.value?.name;
      const next = clonePolicy(state.policy);
      const target = next.projects[index];
      if (kind === 'mcp' && isMcpServerName(name)) {
        target.mcp.servers = target.mcp.servers.filter((item) => item !== name);
      } else if (kind === 'skill' && isSkillName(name)) {
        target.skills.names = target.skills.names.filter((item) => item !== name);
      } else {
        return patchFor(state);
      }
      return deferredSave(state, next);
    },

    'refresh': (scope, event) => {
      const state = actionState(scope, event);
      state.warning = undefined;
      state.saved = false;
      void refreshCatalog(state, { force: true });
      return patchFor(state);
    },

    'form-change': (scope, event) => {
      const state = actionState(scope, event);
      const bind = event?.value?.bind;
      const value = event?.value?.value;
      if (bind === 'data.form.path') state.form.path = typeof value === 'string' ? value.slice(0, 2000) : '';
      if (bind === 'data.form.label') state.form.label = typeof value === 'string' ? value.slice(0, 120) : '';
      return { patch: { form: { path: state.form.path, label: state.form.label } } };
    }
  };

  return {
    view(scope, caps) {
      return buildView(caps);
    },

    data(scope, emit, caps) {
      const state = ensureState(scope, caps);
      const previousEmit = state.emit;
      state.emit = emit;
      state.feeds += 1;

      if (!state.started) {
        state.started = true;
        emitState(state);
        void refreshCatalog(state);
      } else {
        emitState(state);
      }

      return () => {
        state.feeds = Math.max(0, state.feeds - 1);
        if (state.emit === emit) state.emit = previousEmit === emit ? null : previousEmit;
        if (state.feeds === 0) disposeState(state);
      };
    },

    actions
  };
}
