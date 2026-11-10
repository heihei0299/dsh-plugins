import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  canonicalizeProjectPath,
  createConfigStore,
  displayPath,
  resolveDshHome,
  resolveStateFile
} from '../src/host/config-store.js';
import { normalizePolicy } from '../src/host/policy.js';

async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'msm-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function policyFor(projectPath, servers = ['rea']) {
  return normalizePolicy({
    version: 1,
    projects: [{
      path: projectPath,
      label: 'test',
      mcp: { mode: 'selected', servers },
      skills: { mode: 'selected', names: [] }
    }]
  }, {
    platform: 'posix',
    canonicalize: (value) => ({ path: value, exists: true, directory: true })
  }).policy;
}

test('missing policy file reads as the empty default', async (t) => {
  const dir = await tempDir(t);
  const store = createConfigStore({ file: join(dir, 'missing.json'), platform: 'posix', env: { DSH_HOME: dir } });
  const loaded = store.readSync();
  assert.deepEqual(loaded.policy, { version: 1, projects: [] });
  assert.equal(loaded.error, null);
});

test('writes atomically with 0600 permissions and reads back', async (t) => {
  const dir = await tempDir(t);
  const file = join(dir, 'policy.json');
  const store = createConfigStore({ file, platform: 'posix', env: { DSH_HOME: dir } });
  const policy = policyFor(dir);
  await store.write(policy);
  const parsed = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(parsed, policy);
  if (process.platform !== 'win32') {
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  }
  const loaded = store.readSync();
  assert.equal(loaded.error, null);
  assert.deepEqual(loaded.policy, policy);
});

test('corrupt policy files fall back to the empty default with an error', async (t) => {
  const dir = await tempDir(t);
  const file = join(dir, 'policy.json');
  await writeFile(file, '{not json', 'utf8');
  const store = createConfigStore({ file, platform: 'posix', env: { DSH_HOME: dir } });
  const loaded = store.readSync();
  assert.deepEqual(loaded.policy, { version: 1, projects: [] });
  assert.equal(loaded.error.code, 'invalid-policy');
  assert.match(loaded.error.message, /JSON|Unexpected/i);
});

test('serializes concurrent writes in call order', async (t) => {
  const dir = await tempDir(t);
  const file = join(dir, 'policy.json');
  const store = createConfigStore({ file, platform: 'posix', env: { DSH_HOME: dir } });
  const first = policyFor(dir, ['a']);
  const second = policyFor(dir, ['b']);
  await Promise.all([store.write(first), store.write(second)]);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), second);
});

test('resolves the default path and reports relative overrides', () => {
  const resolved = resolveStateFile('relative.json', { DSH_HOME: '/tmp/dsh-home' });
  assert.equal(resolved.file, join('/tmp/dsh-home', 'mcp-skill-manager.json'));
  assert.match(resolved.warning, /absolute path/);
  assert.equal(resolveDshHome({ DSH_HOME: '/tmp/dsh-home' }), '/tmp/dsh-home');
});

test('displayPath uses the documented home symbol', () => {
  assert.equal(displayPath('/tmp/dsh-home/policy.json', { DSH_HOME: '/tmp/dsh-home' }), '$DSH_HOME/policy.json');
  assert.equal(displayPath('/tmp/dsh-home', { DSH_HOME: '/tmp/dsh-home' }), '$DSH_HOME');
  assert.equal(displayPath('/elsewhere/policy.json', { DSH_HOME: '/tmp/dsh-home' }), '/elsewhere/policy.json');
});

test('canonicalizeProjectPath distinguishes directories, files, and missing paths', async (t) => {
  const dir = await tempDir(t);
  const missing = join(dir, 'missing');
  assert.deepEqual(canonicalizeProjectPath(dir, 'posix'), { path: dir, exists: true, directory: true });
  const file = join(dir, 'file.txt');
  await writeFile(file, 'x', 'utf8');
  assert.deepEqual(canonicalizeProjectPath(file, 'posix'), { path: file, exists: true, directory: false });
  assert.deepEqual(canonicalizeProjectPath(missing, 'posix'), { path: missing, exists: false, directory: false });
});
