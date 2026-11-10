/**
 * Stateful container for the MCP & Skill settings section.
 *
 * @module @local/dsh-mcp-skill-manager/client/Container
 */

import * as React from 'react';
import { ApiError, fetchSkills, fetchState, saveConfig } from './api.js';
import {
  addProject,
  clonePolicy,
  findProject,
  knownServers,
  knownSkills,
  policySignature,
  removeProject,
  setMcpMode,
  setSkillMode,
  toggleMcpServer,
  toggleSkill,
  updateLabel
} from './model.js';
import { Panel } from './Panel.js';

/** Re-render when the active locale changes. */
function useLocaleRevision(ctx) {
  const subscribe = React.useCallback((listener) => ctx.locale.subscribe(listener), [ctx]);
  const getSnapshot = React.useCallback(() => ctx.locale.getSnapshot(), [ctx]);
  React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Turn an API/model failure into a user-facing string. */
function describeError(error, t) {
  if (error instanceof ApiError) {
    if (error.status === 404) return t('hostUnavailable');
    if (error.status === 401 || error.status === 403) return t('forbidden');
    return error.message.length > 0 ? error.message : t('error');
  }
  return error instanceof Error && error.message.length > 0 ? error.message : t('error');
}

/** Read the catalog summary for one path from the cache ref. */
function cachedSkills(ref, path) {
  if (path === null) return undefined;
  return ref.current[path];
}

/** Render the MCP & Skill settings section. */
export function Container({ ctx, t }) {
  useLocaleRevision(ctx);
  const tRef = React.useRef(t);
  tRef.current = t;

  const [phase, setPhase] = React.useState('loading');
  const [loadError, setLoadError] = React.useState(null);
  const [state, setState] = React.useState(null);
  const [policy, setPolicy] = React.useState(null);
  const [saved, setSaved] = React.useState(null);
  const [selectedPath, setSelectedPath] = React.useState(null);
  const [skillCache, setSkillCache] = React.useState({});
  const [skillsPhase, setSkillsPhase] = React.useState('idle');
  const [skillsError, setSkillsError] = React.useState(null);
  const [query, setQuery] = React.useState('');
  const [newPath, setNewPath] = React.useState('');
  const [adding, setAdding] = React.useState(false);
  const [notice, setNotice] = React.useState(null);
  const [saving, setSaving] = React.useState(false);

  const mounted = React.useRef(true);
  const stateAbort = React.useRef(null);
  const skillsAbort = React.useRef(null);
  const skillsRequest = React.useRef(0);
  const selectedRef = React.useRef(selectedPath);
  const skillCacheRef = React.useRef(skillCache);
  selectedRef.current = selectedPath;
  skillCacheRef.current = skillCache;

  const loadState = React.useCallback(async (options2 = {}) => {
    const { initial = false, keepNotice = false, soft = false, selectPath } = options2;
    stateAbort.current?.abort();
    const controller = new AbortController();
    stateAbort.current = controller;
    if (initial) setPhase('loading');
    try {
      const data = await fetchState(controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      setState(data);
      setPhase('ready');
      setLoadError(null);
      const next = clonePolicy(data.config);
      setPolicy(next);
      setSaved(clonePolicy(next));
      setSelectedPath((previous) => {
        const desired = selectPath ?? previous;
        if (typeof desired === 'string' && next.projects.some((project) => project.path === desired)) return desired;
        return next.projects[0]?.path ?? null;
      });
      if (!keepNotice) setNotice(null);
    } catch (error) {
      if (controller.signal.aborted || !mounted.current) return;
      if (soft) {
        setNotice({ kind: 'error', text: describeError(error, tRef.current) });
      } else {
        setPhase('failed');
        setLoadError(describeError(error, tRef.current));
      }
    }
  }, []);

  const loadSkills = React.useCallback(async (path, force = false) => {
    if (typeof path !== 'string' || path.length === 0) {
      skillsAbort.current?.abort();
      setSkillsPhase('idle');
      setSkillsError(null);
      return;
    }
    if (!force && cachedSkills(skillCacheRef, path) !== undefined) {
      setSkillsPhase('ready');
      setSkillsError(null);
      return;
    }
    skillsAbort.current?.abort();
    const controller = new AbortController();
    skillsAbort.current = controller;
    const request = skillsRequest.current + 1;
    skillsRequest.current = request;
    setSkillsPhase('loading');
    setSkillsError(null);
    try {
      const data = await fetchSkills(path, controller.signal);
      if (!mounted.current || controller.signal.aborted || request !== skillsRequest.current) return;
      setSkillCache((previous) => ({ ...previous, [path]: data }));
      setSkillsPhase('ready');
    } catch (error) {
      if (controller.signal.aborted || request !== skillsRequest.current || !mounted.current) return;
      setSkillsPhase('failed');
      setSkillsError(describeError(error, tRef.current));
    }
  }, []);

  React.useEffect(() => {
    mounted.current = true;
    loadState({ initial: true });
    return () => {
      mounted.current = false;
      stateAbort.current?.abort();
      skillsAbort.current?.abort();
    };
  }, [loadState]);

  React.useEffect(() => {
    setQuery('');
    loadSkills(selectedPath, false);
  }, [selectedPath, loadSkills]);

  const currentSkills = cachedSkills(skillCacheRef, selectedPath);

  function currentProject() {
    return findProject(policy, selectedPath);
  }

  function currentKnownServers(project) {
    return knownServers(project, state?.servers ?? []);
  }

  function currentKnownSkills(project) {
    return knownSkills(project, cachedSkills(skillCacheRef, selectedPath)?.skills ?? []);
  }

  function handleSelect(path) {
    setSelectedPath(path);
    setNotice(null);
    setAdding(false);
  }

  function handleToggleAdd() {
    setAdding((value) => !value);
    setNewPath('');
    setNotice(null);
  }

  function handleAddProject() {
    try {
      const result = addProject(policy, newPath);
      setPolicy(result.policy);
      setSelectedPath(result.project.path);
      setNewPath('');
      setAdding(false);
      setNotice({ kind: 'info', text: t('unsaved') });
    } catch (error) {
      const key = error?.code === 'path-required'
        ? 'pathRequired'
        : error?.code === 'path-absolute'
          ? 'pathAbsolute'
          : error?.code === 'duplicate'
            ? 'duplicateProject'
            : 'error';
      setNotice({ kind: 'error', text: t(key) });
    }
  }

  function handleRemoveProject(path) {
    const next = removeProject(policy, path);
    setPolicy(next);
    if (selectedPath === path) setSelectedPath(next.projects[0]?.path ?? null);
    setNotice({ kind: 'info', text: t('unsaved') });
  }

  function handleLabel(label) {
    setPolicy((previous) => updateLabel(previous, selectedPath, label));
  }

  function handleMcpMode(mode) {
    const project = currentProject();
    if (project === undefined) return;
    setPolicy((previous) => ({
      ...previous,
      projects: previous.projects.map((entry) =>
        entry.path === selectedPath ? setMcpMode(project, mode, currentKnownServers(project)) : entry
      )
    }));
  }

  function handleToggleServer(name) {
    setPolicy((previous) => ({
      ...previous,
      projects: previous.projects.map((entry) =>
        entry.path === selectedPath ? toggleMcpServer(entry, name, currentKnownServers(entry)) : entry
      )
    }));
  }

  function handleSkillMode(mode) {
    const project = currentProject();
    if (project === undefined) return;
    setPolicy((previous) => ({
      ...previous,
      projects: previous.projects.map((entry) =>
        entry.path === selectedPath ? setSkillMode(project, mode, currentKnownSkills(project)) : entry
      )
    }));
  }

  function handleToggleSkill(name) {
    setPolicy((previous) => ({
      ...previous,
      projects: previous.projects.map((entry) =>
        entry.path === selectedPath ? toggleSkill(entry, name, currentKnownSkills(entry)) : entry
      )
    }));
  }

  async function handleSave() {
    if (policy === null || saving) return;
    const index = policy.projects.findIndex((project) => project.path === selectedPath);
    setSaving(true);
    setNotice(null);
    try {
      const result = await saveConfig(policy);
      const next = clonePolicy(result.config);
      const nextSelected = next.projects[index]?.path ?? next.projects[0]?.path ?? null;
      setPolicy(next);
      setSaved(clonePolicy(next));
      setSelectedPath(nextSelected);
      if (result.warnings?.length > 0) {
        setNotice({
          kind: 'warn',
          text: t('warnings', { message: result.warnings.map((warning) => warning.message).join('; ') })
        });
      } else {
        setNotice({ kind: 'success', text: t('saved') });
      }
      await loadState({ keepNotice: true, soft: true, selectPath: nextSelected });
      await loadSkills(nextSelected, true);
    } catch (error) {
      setNotice({ kind: 'error', text: describeError(error, tRef.current) });
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    const next = clonePolicy(saved);
    setPolicy(next);
    setSelectedPath((previous) =>
      next.projects.some((project) => project.path === previous) ? previous : next.projects[0]?.path ?? null
    );
    setNotice(null);
  }

  function handleRefresh() {
    setNotice(null);
    loadState({ soft: state !== null });
    if (typeof selectedRef.current === 'string') loadSkills(selectedRef.current, true);
  }

  const dirty = policy !== null && saved !== null && policySignature(policy) !== policySignature(saved);

  return React.createElement(Panel, {
    t,
    state,
    policy,
    phase,
    loadError,
    selectedPath,
    skills: currentSkills,
    skillsPhase,
    skillsError,
    query,
    newPath,
    adding,
    saving,
    notice,
    dirty,
    onRefresh: handleRefresh,
    onSelect: handleSelect,
    onNewPath: setNewPath,
    onToggleAdd: handleToggleAdd,
    onAddProject: handleAddProject,
    onRemoveProject: handleRemoveProject,
    onLabel: handleLabel,
    onMcpMode: handleMcpMode,
    onToggleServer: handleToggleServer,
    onSkillMode: handleSkillMode,
    onToggleSkill: handleToggleSkill,
    onQuery: setQuery,
    onSave: handleSave,
    onReset: handleReset
  });
}
