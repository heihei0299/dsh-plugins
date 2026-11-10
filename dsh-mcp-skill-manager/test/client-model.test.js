import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ModelError,
  addProject,
  basenamePath,
  clonePolicy,
  defaultProject,
  findProject,
  isAbsolutePath,
  knownServers,
  knownSkills,
  policySignature,
  removeProject,
  setMcpMode,
  setSkillMode,
  toggleMcpServer,
  toggleSkill,
  updateLabel,
  updateProject
} from '../src/client/model.js';

function emptyPolicy() {
  return { version: 1, projects: [] };
}

test('recognizes absolute POSIX, drive, and UNC paths', () => {
  assert.equal(isAbsolutePath('/repo'), true);
  assert.equal(isAbsolutePath('C:\\repo'), true);
  assert.equal(isAbsolutePath('c:/repo'), true);
  assert.equal(isAbsolutePath('\\\\server\\share'), true);
  assert.equal(isAbsolutePath('repo'), false);
  assert.equal(isAbsolutePath(''), false);
  assert.equal(isAbsolutePath(undefined), false);
});

test('basenamePath keeps the root and handles both separators', () => {
  assert.equal(basenamePath('/a/b/'), 'b');
  assert.equal(basenamePath('C:\\a\\b'), 'b');
  assert.equal(basenamePath('/'), '/');
});

test('addProject validates and returns a default all-enabled project', () => {
  const { policy, project } = addProject(emptyPolicy(), '  /repo  ');
  assert.equal(project.path, '/repo');
  assert.equal(project.label, 'repo');
  assert.deepEqual(project.mcp, { mode: 'all', servers: [] });
  assert.deepEqual(project.skills, { mode: 'all', names: [] });
  assert.equal(policy.projects.length, 1);
  assert.throws(() => addProject(emptyPolicy(), ''), (error) => error instanceof ModelError && error.code === 'path-required');
  assert.throws(() => addProject(emptyPolicy(), 'relative'), (error) => error.code === 'path-absolute');
  assert.throws(() => addProject(policy, '/repo'), (error) => error.code === 'duplicate');
});

test('removeProject and updateLabel are immutable', () => {
  const { policy } = addProject(emptyPolicy(), '/repo');
  const renamed = updateLabel(policy, '/repo', 'Renamed');
  assert.equal(policy.projects[0].label, 'repo');
  assert.equal(renamed.projects[0].label, 'Renamed');
  const removed = removeProject(renamed, '/repo');
  assert.equal(renamed.projects.length, 1);
  assert.equal(removed.projects.length, 0);
});

test('updateProject clones the selected project only', () => {
  const policy = { version: 1, projects: [defaultProject('/a'), defaultProject('/b')] };
  const next = updateProject(policy, '/a', (project) => ({ ...project, label: 'A' }));
  assert.equal(policy.projects[0].label, 'a');
  assert.equal(next.projects[0].label, 'A');
  assert.equal(next.projects[1].label, 'b');
});

test('all-to-selected mode preserves every currently known item', () => {
  const project = defaultProject('/repo');
  const mcp = setMcpMode(project, 'selected', ['b', 'a']);
  assert.deepEqual(mcp.mcp, { mode: 'selected', servers: ['a', 'b'] });
  const skills = setSkillMode(project, 'selected', ['tdd', 'grilling']);
  assert.deepEqual(skills.skills, { mode: 'selected', names: ['grilling', 'tdd'] });
});

test('unchecking in All switches to Selected with the rest enabled', () => {
  const project = defaultProject('/repo');
  const mcp = toggleMcpServer(project, 'a', ['a', 'b']);
  assert.deepEqual(mcp.mcp, { mode: 'selected', servers: ['b'] });
  const skills = toggleSkill(project, 'tdd', ['tdd', 'grilling']);
  assert.deepEqual(skills.skills, { mode: 'selected', names: ['grilling'] });
});

test('Selected toggles add and remove names', () => {
  const project = {
    ...defaultProject('/repo'),
    mcp: { mode: 'selected', servers: ['b'] },
    skills: { mode: 'selected', names: ['grilling'] }
  };
  assert.deepEqual(toggleMcpServer(project, 'a', ['a', 'b']).mcp.servers, ['a', 'b']);
  assert.deepEqual(toggleMcpServer(project, 'b', ['a', 'b']).mcp.servers, []);
  assert.deepEqual(toggleSkill(project, 'tdd', ['tdd', 'grilling']).skills.names, ['grilling', 'tdd']);
  assert.deepEqual(toggleSkill(project, 'grilling', ['tdd', 'grilling']).skills.names, []);
});

test('knownServers and knownSkills merge snapshot and saved names', () => {
  const project = {
    ...defaultProject('/repo'),
    mcp: { mode: 'selected', servers: ['stale'] },
    skills: { mode: 'selected', names: ['old-skill'] }
  };
  assert.deepEqual(knownServers(project, [{ serverName: 'rea' }, 'chrome']), ['chrome', 'rea', 'stale']);
  assert.deepEqual(knownSkills(project, [{ name: 'tdd' }]), ['old-skill', 'tdd']);
});

test('policySignature tracks draft changes and clonePolicy is deep', () => {
  const { policy } = addProject(emptyPolicy(), '/repo');
  const clone = clonePolicy(policy);
  assert.deepEqual(clone, policy);
  clone.projects[0].mcp.mode = 'selected';
  assert.notEqual(policy.projects[0].mcp.mode, 'selected');
  assert.notEqual(policySignature(policy), policySignature(clone));
  assert.equal(findProject(policy, '/repo').label, 'repo');
});
