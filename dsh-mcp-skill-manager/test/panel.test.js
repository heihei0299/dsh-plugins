import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Panel } from '../src/client/Panel.js';

const t = (key, params) => {
  if (params !== undefined && Object.hasOwn(params, 'count')) return `${key}:${params.count}`;
  if (params !== undefined && Object.hasOwn(params, 'message')) return `${key}:${params.message}`;
  return key;
};

const state = {
  stateFile: '~/.dsh/test.json',
  projects: [{
    path: '/repo',
    label: 'Repo',
    mcp: { mode: 'selected', servers: ['rea'] },
    skills: { mode: 'selected', names: ['tdd'] },
    exists: true
  }],
  servers: [
    {
      serverName: 'chrome',
      transport: 'stdio',
      origin: 'profile',
      disabled: false,
      toolCount: 1,
      toolNames: ['mcp__chrome__open'],
      toolsTruncated: false
    },
    {
      serverName: 'rea',
      transport: 'stdio',
      origin: 'profile',
      disabled: false,
      toolCount: 2,
      toolNames: ['mcp__rea__a', 'mcp__rea__b'],
      toolsTruncated: false
    }
  ],
  workspaceSuggestions: [],
  liveAgents: [],
  loaderAvailable: true,
  skillsAvailable: true,
  configError: null,
  warnings: []
};

const policy = {
  version: 1,
  projects: [{
    path: '/repo',
    label: 'Repo',
    mcp: { mode: 'selected', servers: ['rea'] },
    skills: { mode: 'selected', names: ['tdd'] }
  }]
};

const skills = {
  complete: true,
  preset: 'standard',
  skills: [
    { name: 'grilling', description: 'Grill a plan', source: 'user', provider: 'filesystem', invocation: { modelInvocable: true, userInvocable: true } },
    { name: 'tdd', description: 'Test driven development', source: 'user', provider: 'filesystem', invocation: { modelInvocable: true, userInvocable: true } }
  ]
};

function props(overrides = {}) {
  return {
    t,
    state,
    policy,
    phase: 'ready',
    loadError: null,
    selectedPath: '/repo',
    skills,
    skillsPhase: 'ready',
    skillsError: null,
    query: '',
    newPath: '',
    adding: false,
    saving: false,
    notice: null,
    dirty: false,
    onRefresh: () => {},
    onSelect: () => {},
    onNewPath: () => {},
    onToggleAdd: () => {},
    onAddProject: () => {},
    onRemoveProject: () => {},
    onLabel: () => {},
    onMcpMode: () => {},
    onToggleServer: () => {},
    onSkillMode: () => {},
    onToggleSkill: () => {},
    onQuery: () => {},
    onSave: () => {},
    onReset: () => {},
    ...overrides
  };
}

test('renders project, MCP servers, and skills with selected state', () => {
  const html = renderToStaticMarkup(React.createElement(Panel, props()));
  assert.match(html, /data-msm-project="\/repo"/);
  assert.match(html, /data-msm-server="rea"/);
  assert.match(html, /data-msm-server="chrome"/);
  assert.match(html, /data-msm-skill="tdd"/);
  assert.match(html, /data-msm-skill="grilling"/);
  assert.match(html, /data-msm-section="mcp"/);
  assert.match(html, /data-msm-section="skills"/);
  assert.match(html, /msm-mode__button/);
  assert.match(html, /serverToolCount:2/);
  assert.match(html, /selectedCount:1/);
  assert.match(html, /aria-pressed="true"/);
});

test('renders loading and host-unavailable states', () => {
  const loading = renderToStaticMarkup(React.createElement(Panel, props({
    state: null,
    policy: null,
    phase: 'loading'
  })));
  assert.match(loading, /loading/);

  const failed = renderToStaticMarkup(React.createElement(Panel, props({
    state: null,
    policy: null,
    phase: 'failed',
    loadError: 'host-unavailable'
  })));
  assert.match(failed, /host-unavailable/);
  assert.match(failed, /retry/);
});

test('shows configuration errors and incomplete catalogs', () => {
  const html = renderToStaticMarkup(React.createElement(Panel, props({
    state: {
      ...state,
      configError: { code: 'invalid-policy', message: 'bad json' },
      warnings: [{ code: 'config', message: 'missing directory' }]
    },
    skills: { ...skills, complete: false, warning: 'provider failed' }
  })));
  assert.match(html, /configError:bad json/);
  assert.match(html, /warnings:missing directory/);
  assert.match(html, /incomplete/);
  assert.match(html, /provider failed/);
});
