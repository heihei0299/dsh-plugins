import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultPolicy,
  isWithin,
  mcpDenyForProject,
  mcpServerEnabled,
  normalizePath,
  normalizePolicy,
  projectForCwd,
  sanitizeUrl,
  skillEnabled,
  skillNamesToDisable
} from '../src/host/policy.js';
import {
  MCP_RESOURCE_TOOLS,
  mcpServerOfToolName,
  parseMcpToolName
} from '../src/shared/contract.js';

const identity = (value) => ({ path: value, exists: true, directory: true });

function normalize(input, platform = 'posix') {
  return normalizePolicy(input, { platform, canonicalize: identity });
}

test('default policy is empty and stable', () => {
  assert.deepEqual(defaultPolicy(), { version: 1, projects: [] });
});

test('normalizes a complete project and defaults missing sections', () => {
  const { policy, warnings } = normalize({
    version: 1,
    projects: [
      {
        path: '/repo',
        label: '  Repo  ',
        mcp: { mode: 'selected', servers: ['rea', 'rea'] },
        skills: { mode: 'selected', names: ['tdd'] }
      },
      { path: '/empty' }
    ]
  });
  assert.deepEqual(warnings, []);
  assert.equal(policy.projects[0].label, 'Repo');
  assert.deepEqual(policy.projects[0].mcp.servers, ['rea']);
  assert.deepEqual(policy.projects[1].mcp, { mode: 'all', servers: [] });
  assert.deepEqual(policy.projects[1].skills, { mode: 'all', names: [] });
  assert.equal(policy.projects[1].label, 'empty');
});

test('rejects invalid versions, modes, paths, names, and duplicates', () => {
  assert.throws(() => normalize({ version: 2 }), /Unsupported policy version/);
  assert.throws(() => normalize({ version: 1, projects: {} }), /projects must be an array/);
  assert.throws(() => normalize({ version: 1, projects: [{ path: 'relative' }] }), /must be absolute/);
  assert.throws(() => normalize({ version: 1, projects: [{ path: '/a' }, { path: '/a/' }] }), /Duplicate project/);
  assert.throws(
    () => normalize({ version: 1, projects: [{ path: '/a', mcp: { mode: 'none' } }] }),
    /mode must be "all" or "selected"/
  );
  assert.throws(
    () => normalize({ version: 1, projects: [{ path: '/a', mcp: { mode: 'selected', servers: ['bad server'] } }] }),
    /invalid name/
  );
  assert.throws(
    () => normalize({ version: 1, projects: [{ path: '/a', skills: { mode: 'selected', names: ['Bad'] } }] }),
    /invalid name/
  );
  assert.throws(
    () => normalizePolicy({ version: 1, projects: [{ path: '/file' }] }, {
      platform: 'posix',
      canonicalize: () => ({ path: '/file', exists: true, directory: false })
    }),
    /not a directory/
  );
});

test('warns about missing directories without rejecting them', () => {
  const { policy, warnings } = normalizePolicy({ version: 1, projects: [{ path: '/missing' }] }, {
    platform: 'posix',
    canonicalize: () => ({ path: '/missing', exists: false, directory: false })
  });
  assert.equal(policy.projects.length, 1);
  assert.deepEqual(warnings, [
    { code: 'missing-directory', path: '/missing', message: 'Project directory does not exist' }
  ]);
});

test('matches the longest project prefix and ignores lookalike siblings', () => {
  const { policy } = normalize({
    version: 1,
    projects: [
      { path: '/repo', label: 'root' },
      { path: '/repo/pkg', label: 'pkg' },
      { path: '/other', label: 'other' }
    ]
  });
  assert.equal(projectForCwd(policy, '/repo/pkg/src').label, 'pkg');
  assert.equal(projectForCwd(policy, '/repo/tools').label, 'root');
  assert.equal(projectForCwd(policy, '/repository'), undefined);
  assert.equal(projectForCwd(policy, '/repo/pkg').label, 'pkg');
});

test('matches Windows paths case-insensitively and normalizes separators', () => {
  const { policy } = normalize({
    version: 1,
    projects: [{ path: 'C:\\Repo', label: 'win' }]
  }, 'win32');
  assert.equal(projectForCwd(policy, 'c:\\repo\\src', 'win32').label, 'win');
  assert.equal(isWithin('C:\\Repo\\src', 'c:\\repo', 'win32'), true);
  assert.equal(isWithin('C:\\Repository', 'C:\\Repo', 'win32'), false);
  assert.equal(normalizePath('C:\\Repo\\', 'win32'), 'C:\\Repo');
});

test('MCP deny covers unselected servers and empty selected sets', () => {
  const { policy } = normalize({
    version: 1,
    projects: [
      { path: '/repo', mcp: { mode: 'selected', servers: ['rea'] } },
      { path: '/none', mcp: { mode: 'selected', servers: [] } },
      { path: '/all', mcp: { mode: 'all', servers: [] } }
    ],
    skills: { mode: 'selected', names: ['tdd'] }
  });
  const groups = new Map([
    ['rea', ['mcp__rea__read']],
    ['chrome', ['mcp__chrome__open']]
  ]);
  assert.deepEqual(mcpDenyForProject(policy.projects[0], groups), ['mcp__chrome__open']);
  assert.deepEqual(
    mcpDenyForProject(policy.projects[1], groups),
    ['mcp__chrome__open', 'mcp__rea__read', ...MCP_RESOURCE_TOOLS].sort()
  );
  assert.deepEqual(mcpDenyForProject(policy.projects[2], groups), []);
  assert.equal(mcpServerEnabled(policy.projects[0], 'rea'), true);
  assert.equal(mcpServerEnabled(policy.projects[0], 'chrome'), false);
});

test('skill filtering only applies to selected projects', () => {
  const { policy } = normalize({
    version: 1,
    projects: [
      { path: '/repo', skills: { mode: 'selected', names: ['tdd'] } },
      { path: '/all', skills: { mode: 'all', names: [] } }
    ]
  });
  assert.deepEqual(skillNamesToDisable(policy.projects[0], ['tdd', 'grilling', 'tdd']), ['grilling']);
  assert.deepEqual(skillNamesToDisable(policy.projects[1], ['tdd', 'grilling']), []);
  assert.equal(skillEnabled(policy.projects[0], 'tdd'), true);
  assert.equal(skillEnabled(policy.projects[0], 'grilling'), false);
});

test('parses public MCP tool names with known-name disambiguation', () => {
  assert.deepEqual(parseMcpToolName('mcp__rea__read_file'), { serverName: 'rea', rawName: 'read_file' });
  assert.equal(parseMcpToolName('mcp__rea__read_file', ['rea']).serverName, 'rea');
  assert.equal(parseMcpToolName('mcp__my__server__tool', ['my__server']).serverName, 'my__server');
  assert.equal(mcpServerOfToolName('mcp__rea__read_file', ['rea']), 'rea');
  assert.equal(parseMcpToolName('read_file'), undefined);
  assert.equal(parseMcpToolName('mcp____tool'), undefined);
});

test('sanitizes MCP endpoint URLs', () => {
  assert.equal(sanitizeUrl('https://user:pass@example.test:8443/mcp?token=abc#frag'), 'https://example.test:8443/mcp');
  assert.equal(sanitizeUrl('file:///etc/passwd'), undefined);
  assert.equal(sanitizeUrl('not a url'), undefined);
});
