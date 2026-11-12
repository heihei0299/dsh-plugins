/**
 * Discovery of the managed MCP fleet shipped from DSH 0.2.2-rc.2 on: those
 * servers live in `ctx.mcpManager` instead of one loader entry each, so the
 * panel must read both sources without duplicating a name.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverServers, managerMcpServers } from '../src/host/discovery.js';

/** Host context exposing exactly the given services. */
function context(services = {}) {
  return { get: (name) => services[name], ...services };
}

test('a runtime without the managed fleet reports no manager servers', () => {
  assert.deepEqual(managerMcpServers(context()), []);
  assert.deepEqual(managerMcpServers(context({ mcpManager: {} })), [], 'no list() means no service contract');
  assert.deepEqual(managerMcpServers(context({ mcpManager: { list: () => undefined } })), []);
  assert.deepEqual(managerMcpServers(context({ mcpManager: { list: () => { throw new Error('gone'); } } })), []);
});

test('managed servers carry their own origin and keep the runtime state', () => {
  const ctx = context({
    mcpManager: {
      list: () => [
        { name: 'chrome', configured: true, status: { state: 'ready' } },
        { name: 'rea', configured: true, status: { state: 'disabled', status: { state: 'closed' } } },
        { name: 'not a server name', configured: true, status: { state: 'ready' } },
        null
      ]
    }
  });
  assert.deepEqual(managerMcpServers(ctx).map((row) => [row.serverName, row.origin, row.disabled]), [
    ['chrome', 'manager', false],
    ['rea', 'manager', true]
  ]);
  const { servers } = discoverServers(ctx);
  assert.deepEqual(servers.map((row) => [row.serverName, row.origin, row.status]), [
    ['chrome', 'manager', 'idle'],
    ['rea', 'manager', 'disabled']
  ]);
});

test('live tools attribute to a managed server', () => {
  const ctx = context({
    mcpManager: { list: () => [{ name: 'chrome', status: { state: 'ready' } }] },
    tools: { definitions: () => [{ name: 'mcp__chrome__open' }] }
  });
  const { servers } = discoverServers(ctx);
  assert.equal(servers.length, 1);
  assert.equal(servers[0].serverName, 'chrome');
  assert.deepEqual(servers[0].toolNames, ['mcp__chrome__open']);
  assert.equal(servers[0].toolCount, 1);
  assert.equal(servers[0].status, 'active');
});

test('a profile entry for the same name keeps its configuration detail', () => {
  const ctx = context({
    loader: {
      entries: () => [{
        options: {
          name: '@deepseek-ai/dsh-mcp-client',
          config: { serverName: 'chrome', transport: 'stdio', command: 'npx', args: ['-y', 'server'] }
        }
      }]
    },
    mcpManager: { list: () => [{ name: 'chrome', status: { state: 'ready' } }] }
  });
  const { servers } = discoverServers(ctx);
  assert.equal(servers.length, 1, 'one row per server name');
  assert.equal(servers[0].origin, 'profile');
  assert.equal(servers[0].command, 'npx');
  assert.equal(servers[0].argsCount, 2);
});
