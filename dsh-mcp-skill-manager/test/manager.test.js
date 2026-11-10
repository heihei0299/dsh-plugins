import test from 'node:test';
import assert from 'node:assert/strict';
import { createManager } from '../src/host/manager.js';

function projectPolicy(overrides = {}) {
  return {
    version: 1,
    projects: [{
      path: '/repo',
      label: 'repo',
      mcp: { mode: 'selected', servers: ['rea'] },
      skills: { mode: 'selected', names: ['tdd'] },
      ...overrides
    }]
  };
}

function setup(options = {}) {
  let currentCwd = options.cwd ?? '/repo';
  let policy = options.policy ?? projectPolicy();
  const catalog = options.catalog ?? [
    { name: 'tdd', description: 'Test driven development', source: 'user', provider: 'filesystem', invocation: { modelInvocable: true, userInvocable: true } },
    { name: 'grilling', description: 'Grill a plan', source: 'user', provider: 'filesystem', invocation: { modelInvocable: true, userInvocable: true } }
  ];
  const globalTools = new Map([
    ['mcp__rea__read', { name: 'mcp__rea__read' }],
    ['mcp__chrome__open', { name: 'mcp__chrome__open' }]
  ]);
  const restrictions = [];
  const guards = [];
  const sectionRecords = [];
  const sections = new Map();
  const registered = new Map();
  const preStepRecords = [];
  let preStep;

  const globalToolsService = {
    definitions: () => [...globalTools.values()],
    guard: (fn) => {
      const record = { fn, disposed: false };
      guards.push(record);
      return () => { record.disposed = true; };
    }
  };
  const agentTools = {
    restrict: (filter) => {
      const record = { deny: [...filter.deny], disposed: false };
      restrictions.push(record);
      return () => { record.disposed = true; };
    }
  };
  const systemPrompt = {
    section: (section) => {
      const record = { name: section.name, section, disposed: false };
      sectionRecords.push(record);
      sections.set(section.name, section);
      return () => {
        record.disposed = true;
        if (sections.get(section.name) === section) sections.delete(section.name);
      };
    },
    getSectionOrder: () => 3100
  };
  const skills = {
    snapshot: async () => ({ skills: catalog.map((skill) => ({ ...skill })), complete: true }),
    register: (skill) => {
      registered.set(skill.name, skill);
      return () => { registered.delete(skill.name); };
    }
  };

  const agent = {
    id: 'session-1',
    session: { id: 'session-1', header: { cwd: currentCwd } },
    ctx: {
      get: (name) => {
        if (name === 'tools') return agentTools;
        if (name === 'skills') return skills;
        if (name === 'systemPrompt') return systemPrompt;
        return undefined;
      },
      on: (event, listener) => {
        if (event === 'agent/pre-step') {
          preStep = listener;
          preStepRecords.push(listener);
        }
        return () => { if (preStep === listener) preStep = undefined; };
      }
    }
  };

  const agents = {
    list: () => [agent],
    get: (id) => (id === agent.id ? agent : undefined)
  };
  const listeners = new Map();
  const ctx = {
    logger: { warn: () => {} },
    get: (name) => {
      if (name === 'tools') return globalToolsService;
      if (name === 'agents') return agents;
      if (name === 'workingDirectory') return { get: () => currentCwd };
      if (name === 'loader') return { entries: function* () {} };
      return undefined;
    },
    on: (event, listener) => {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
      return () => {
        const index = list.indexOf(listener);
        if (index >= 0) list.splice(index, 1);
      };
    },
    emit: (event, ...args) => {
      for (const listener of [...(listeners.get(event) ?? [])]) listener(...args);
    }
  };
  const store = {
    platform: 'posix',
    displayFile: '~/.dsh/test.json',
    getPolicy: () => policy,
    write: async (next) => { policy = next; },
    getError: () => null,
    getWarnings: () => []
  };
  const manager = createManager({ ctx, store });
  return {
    agent,
    agents,
    ctx,
    manager,
    restrictions,
    guards,
    sections,
    sectionRecords,
    registered,
    skills,
    preStepRecords,
    store,
    setCwd: (value) => { currentCwd = value; },
    setPolicy: (value) => { policy = value; },
    addTool: (name) => { globalTools.set(name, { name }); },
    get preStep() { return preStep; }
  };
}

test('selected policy restricts MCP tools, shadows prompts, and stubs skills', async () => {
  const fixture = setup();
  await fixture.manager.attach(fixture.agent);

  assert.equal(fixture.restrictions.length, 1);
  assert.deepEqual(fixture.restrictions[0].deny, ['mcp__chrome__open']);

  assert.equal(fixture.sections.get('mcp:chrome').text, '');
  assert.match(fixture.sections.get('mcp-resource-servers').text, /"rea"/);
  assert.equal(fixture.sections.has('mcp:rea'), false);

  assert.equal(fixture.registered.has('grilling'), true);
  assert.equal(fixture.registered.has('tdd'), false);
  assert.deepEqual(fixture.registered.get('grilling').invocation, { modelInvocable: false, userInvocable: false });
});

test('all-enabled projects add no restriction, shadow, or stub', async () => {
  const fixture = setup({ policy: { version: 1, projects: [] } });
  await fixture.manager.attach(fixture.agent);
  assert.deepEqual(fixture.restrictions, []);
  assert.equal(fixture.sections.size, 0);
  assert.equal(fixture.registered.size, 0);
});

test('a working-directory change removes the old project effects', async () => {
  const fixture = setup();
  await fixture.manager.start();
  fixture.setCwd('/elsewhere');
  fixture.ctx.emit('session/event', { id: 'session-1' }, {
    type: 'working-directory/change',
    data: { cwd: '/elsewhere' }
  });
  await fixture.manager.flush();

  assert.equal(fixture.restrictions[0].disposed, true);
  assert.equal(fixture.sections.size, 0);
  assert.equal(fixture.registered.size, 0);
});

test('tools/change re-restricts newly appeared MCP tools', async () => {
  const fixture = setup();
  await fixture.manager.start();
  fixture.addTool('mcp__chrome__new');
  fixture.ctx.emit('tools/change');
  await fixture.manager.flush();
  const latest = fixture.restrictions.at(-1);
  assert.deepEqual(latest.deny, ['mcp__chrome__new', 'mcp__chrome__open']);
});

test('guard rejects disabled MCP, resource, and skill calls but allows selected ones', async () => {
  const fixture = setup();
  await fixture.manager.attach(fixture.agent);
  const { agent } = fixture;

  assert.match(fixture.manager.guard({ name: 'mcp__chrome__open', agent }), /blocks MCP server "chrome"/);
  assert.equal(fixture.manager.guard({ name: 'mcp__rea__read', agent }), undefined);
  assert.match(fixture.manager.guard({ name: 'skill', arguments: { name: 'grilling' }, agent }), /blocks skill "grilling"/);
  assert.equal(fixture.manager.guard({ name: 'skill', arguments: { name: 'tdd' }, agent }), undefined);
  assert.match(fixture.manager.guard({ name: 'read_mcp_resource', arguments: { server: 'chrome' }, agent }), /blocks MCP server "chrome"/);
  assert.equal(fixture.manager.guard({ name: 'read_mcp_resource', arguments: { server: 'rea' }, agent }), undefined);
});

test('savePolicy writes and immediately swaps the effective policy', async () => {
  const fixture = setup();
  await fixture.manager.attach(fixture.agent);
  const result = await fixture.manager.savePolicy({
    version: 1,
    projects: [{
      path: '/repo',
      label: 'repo',
      mcp: { mode: 'selected', servers: ['chrome'] },
      skills: { mode: 'selected', names: ['grilling'] }
    }]
  });
  assert.equal(result.policy.projects[0].mcp.servers[0], 'chrome');
  assert.deepEqual(result.warnings.map((warning) => warning.code), ['missing-directory']);
  assert.deepEqual(fixture.restrictions.at(-1).deny, ['mcp__rea__read']);
  assert.equal(fixture.sections.get('mcp:rea').text, '');
  assert.equal(fixture.sections.has('mcp:chrome'), false);
  assert.equal(fixture.registered.has('tdd'), true);
  assert.equal(fixture.registered.has('grilling'), false);
});

test('pre-step refresh rebuilds the skill catalog before downstream listeners', async () => {
  const fixture = setup({ policy: { version: 1, projects: [] } });
  await fixture.manager.attach(fixture.agent);
  fixture.setPolicy({
    version: 1,
    projects: [{
      path: '/repo',
      label: 'repo',
      mcp: { mode: 'all', servers: [] },
      skills: { mode: 'selected', names: ['tdd'] }
    }]
  });
  const state = fixture.manager.states.get('session-1');
  state.skillsDirty = true;
  let downstream = false;
  await fixture.preStep({ signal: undefined }, async () => {
    downstream = true;
    return { kind: 'enter', messages: [] };
  });
  assert.equal(downstream, true);
  assert.equal(fixture.registered.has('grilling'), true);
  assert.equal(fixture.registered.has('tdd'), false);
});

test('a failed skill refresh keeps the previous stubs', async () => {
  const fixture = setup();
  await fixture.manager.attach(fixture.agent);
  assert.equal(fixture.registered.has('grilling'), true);

  fixture.skills.snapshot = async () => { throw new Error('catalog unavailable'); };
  const state = fixture.manager.states.get('session-1');
  state.skillsDirty = true;
  await fixture.manager.flush();

  assert.equal(fixture.registered.has('grilling'), true);
  assert.equal(state.skillsDirty, true);
});

test('dispose releases restrictions, sections, stubs, and listeners', async () => {
  const fixture = setup();
  await fixture.manager.start();
  fixture.manager.dispose();
  assert.equal(fixture.restrictions[0].disposed, true);
  assert.equal(fixture.sections.size, 0);
  assert.equal(fixture.registered.size, 0);
  assert.equal(fixture.guards[0].disposed, true);
  assert.equal(fixture.preStep, undefined);
});
