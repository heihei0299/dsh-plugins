import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, registerApi } from '../src/host/api.js';
import { PolicyError, normalizePolicy } from '../src/host/policy.js';

function makeFixture(overrides = {}) {
  const policy = overrides.policy ?? {
    version: 1,
    projects: [{
      path: '/work',
      label: 'Work',
      mcp: { mode: 'selected', servers: ['rea'] },
      skills: { mode: 'selected', names: ['tdd'] }
    }]
  };
  let saved;
  let disposed = false;
  let snapshotScope;
  const skills = {
    snapshot: async (options) => {
      snapshotScope = options.scope;
      return {
        complete: true,
        skills: [
          { name: 'tdd', description: 'Test driven development', source: 'user', provider: 'filesystem', invocation: { modelInvocable: true, userInvocable: true } },
          { name: 'grilling', description: 'Grill a plan', source: 'user', provider: 'filesystem', invocation: { modelInvocable: true, userInvocable: true } }
        ]
      };
    }
  };
  const ctx = {
    logger: { warn: () => {} },
    get: (name) => {
      if (name === 'tools') return {
        definitions: () => [
          { name: 'mcp__rea__read' },
          { name: 'mcp__chrome__open' }
        ]
      };
      if (name === 'loader') return {
        entries: function* () {
          yield {
            options: {
              name: '@deepseek-ai/dsh-mcp-client',
              config: {
                serverName: 'rea',
                transport: 'stdio',
                command: 'rea-mcp',
                env: { TOKEN: 'secret-value' },
                headers: { Authorization: 'secret-value' }
              }
            },
            disabled: false
          };
        }
      };
      if (name === 'skills') return skills;
      if (name === 'agentPresets') return {
        defaultId: 'standard',
        composedPreset: () => 'standard',
        acquireScope: async () => ({
          key: { preset: 'standard' },
          [Symbol.asyncDispose]: async () => { disposed = true; }
        })
      };
      if (name === 'agents') return { list: () => [], get: () => undefined };
      if (name === 'workspaceRegistry') return { list: () => [{ path: '/work', title: 'Work' }] };
      if (name === 'workingDirectory') return { get: () => '/work' };
      return undefined;
    }
  };
  const manager = {
    savePolicy: async (input) => {
      saved = input;
      const normalized = normalizePolicy(input, {
        platform: 'posix',
        canonicalize: (value) => ({ path: value, exists: true, directory: true })
      });
      return { policy: normalized.policy, warnings: normalized.warnings };
    }
  };
  const store = {
    platform: 'posix',
    displayFile: '~/.dsh/test.json',
    getPolicy: () => policy,
    getError: () => null,
    getWarnings: () => [],
    resolveWarning: undefined
  };
  const api = createApi({ ctx, manager, store });
  return {
    api,
    ctx,
    manager,
    store,
    get saved() { return saved; },
    get disposed() { return disposed; }
  };
}

function jsonRequest(url, options = {}) {
  return new Request(url, options);
}

test('state returns servers, projects, suggestions, and no MCP secret values', async () => {
  const fixture = makeFixture();
  const response = await fixture.api.state();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.stateFile, '~/.dsh/test.json');
  const rea = body.servers.find((server) => server.serverName === 'rea');
  assert.equal(rea.origin, 'profile');
  assert.deepEqual(rea.envKeys, ['TOKEN']);
  assert.deepEqual(rea.headerKeys, ['Authorization']);
  assert.equal(rea.command, 'rea-mcp');
  assert.equal(body.projects[0].exists, false);
  assert.ok(body.workspaceSuggestions.some((suggestion) => suggestion.path === '/work'));
  assert.equal(JSON.stringify(body).includes('secret-value'), false);
});

test('skills discovers through a default preset scope and releases the lease', async () => {
  const fixture = makeFixture();
  const response = await fixture.api.skills(jsonRequest(`http://localhost/api/skills?cwd=${encodeURIComponent('/work')}`));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.cwd, '/work');
  assert.equal(body.preset, 'standard');
  assert.equal(body.complete, true);
  assert.deepEqual(body.skills.map((skill) => skill.name), ['grilling', 'tdd']);
  assert.equal(fixture.disposed, true);
});

test('skills rejects a missing or relative cwd', async () => {
  const fixture = makeFixture();
  const missing = await fixture.api.skills(jsonRequest('http://localhost/api/skills'));
  assert.equal(missing.status, 400);
  const relative = await fixture.api.skills(jsonRequest('http://localhost/api/skills?cwd=relative'));
  assert.equal(relative.status, 400);
});

test('config accepts a raw policy document and returns normalized output', async () => {
  const fixture = makeFixture();
  const response = await fixture.api.config(jsonRequest('http://localhost/api/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: 1, projects: [] })
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.config, { version: 1, projects: [] });
  assert.deepEqual(fixture.saved, { version: 1, projects: [] });
});

test('config rejects wrong media type, invalid JSON, and oversized bodies', async () => {
  const fixture = makeFixture();
  const wrongType = await fixture.api.config(jsonRequest('http://localhost/api/config', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: '{}'
  }));
  assert.equal(wrongType.status, 415);

  const invalid = await fixture.api.config(jsonRequest('http://localhost/api/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{'
  }));
  assert.equal(invalid.status, 400);

  const huge = await fixture.api.config(jsonRequest('http://localhost/api/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: 1, projects: [], padding: 'x'.repeat(300 * 1024) })
  }));
  assert.equal(huge.status, 413);
});

test('config maps policy validation failures to 400', async () => {
  const fixture = makeFixture();
  fixture.manager.savePolicy = async () => { throw new PolicyError('bad policy'); };
  const response = await fixture.api.config(jsonRequest('http://localhost/api/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: 1, projects: [] })
  }));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, 'invalid-policy');
});

test('registerApi installs the three authenticated routes', () => {
  const fixture = makeFixture();
  const routes = [];
  const ctx = {
    inject: (services, callback) => {
      assert.deepEqual(services, ['connection']);
      callback({ connection: { fetch: { register: (route) => {
        routes.push(route);
        return async () => {};
      } } } });
    }
  };
  registerApi(ctx, fixture.api);
  assert.deepEqual(routes.map((route) => [route.path, route.methods]), [
    ['/api/mcp-skill-manager/state', ['GET']],
    ['/api/mcp-skill-manager/skills', ['GET']],
    ['/api/mcp-skill-manager/config', ['POST']]
  ]);
});
