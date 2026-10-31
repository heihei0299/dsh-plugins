import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeRoot = process.env.DSH_TEST_RUNTIME_ROOT;
const plugins = [
  ['@local/dsh-history-budget', 'dsh-history-budget'],
  ['@local/dsh-lan-connect', 'dsh-lan-connect'],
  ['@local/dsh-mobile', 'dsh-mobile'],
  ['@local/dsh-smartui', 'dsh-smartui'],
  ['dsh-plugin-pin-subagent-model', 'pin-subagent-model'],
];

/** Import the selected runtime's own evaluator and profile loader. */
async function runtime() {
  const requireRuntime = createRequire(path.join(runtimeRoot, 'package.json'));
  return import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/dsh-app-boot')).href);
}

/** Create an isolated profile, linked to the checkout but not the user's profile. */
async function fixture(t) {
  const parent = await realpath(tmpdir());
  const prefix = 'dsh-plugins-compat-profile-';
  const dir = await mkdtemp(path.join(parent, prefix));
  const resolved = await realpath(dir);
  assert.equal(path.dirname(resolved), parent);
  assert.ok(path.basename(resolved).startsWith(prefix));
  t.after(async () => {
    // Re-check the exact temporary directory before deleting it. Symlinked
    // plugin directories are not followed by rm's recursive traversal.
    assert.equal(await realpath(dir), resolved);
    await rm(resolved, { recursive: true });
  });
  await mkdir(path.join(dir, 'node_modules', '@local'), { recursive: true });
  for (const [name, folder] of plugins) {
    await symlink(path.join(repo, folder), path.join(dir, 'node_modules', name), 'dir');
  }
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({
    name: 'dsh-compat-profile-fixture',
    version: '1.0.0',
    dsh: { profile: { bundles: plugins.map(([name]) => name) } },
  }));
  return dir;
}

test('selected runtime loads all five bundle layers without version exemptions', { skip: !runtimeRoot }, async t => {
  const appBoot = await runtime();
  const dir = await fixture(t);
  const profile = appBoot.loadProfileDirectory('compat-test', dir, path.join(runtimeRoot, 'package.json'), { userLayer: false });
  assert.deepEqual(profile.skippedBundles, []);
  assert.deepEqual(profile.layers.map(layer => layer.packageName), plugins.map(([name]) => name));
  for (const layer of profile.layers) {
    assert.ok(layer.patchPaths.length > 0, `${layer.packageName}: expected a bundle patch`);
    assert.ok(layer.patches.length > 0, `${layer.packageName}: expected a nonempty parsed layer`);
  }
});

test('selected runtime satisfies each declared peer dependency', { skip: !runtimeRoot }, async () => {
  const { evaluatePluginCompatibility } = await runtime();
  const requireRuntime = createRequire(path.join(runtimeRoot, 'package.json'));
  for (const [name, folder] of plugins) {
    const manifest = JSON.parse(await readFile(path.join(repo, folder, 'package.json'), 'utf8'));
    for (const [peer, range] of Object.entries(manifest.peerDependencies ?? {})) {
      const peerManifest = JSON.parse(await readFile(requireRuntime.resolve(`${peer}/package.json`), 'utf8'));
      // Reuse the target runtime's semver evaluator without engines.dsh's
      // precedence masking a peer mismatch. The synthetic range is tested
      // against the actual peer package version, not the DSH version.
      const probe = { name: manifest.name, version: manifest.version, engines: { dsh: range } };
      assert.equal(evaluatePluginCompatibility(probe, {}, peerManifest.version), undefined,
        `${name}: ${peer}@${peerManifest.version} does not satisfy ${range}`);
    }
  }
});

test('selected runtime accepts only the explicitly declared DSH releases', { skip: !runtimeRoot }, async () => {
  const { evaluatePluginCompatibility } = await runtime();
  for (const [name, folder] of plugins) {
    const manifest = JSON.parse(await readFile(path.join(repo, folder, 'package.json'), 'utf8'));
    for (const version of ['0.2.1-rc.2', '0.2.1-rc.5']) {
      assert.equal(evaluatePluginCompatibility(manifest, {}, version), undefined, `${name}: ${version}`);
    }
    for (const version of ['0.2.1-rc.3', '0.2.2-alpha.2']) {
      const issue = evaluatePluginCompatibility(manifest, {}, version);
      assert.equal(issue?.exempted, false, `${name}: ${version} must not be implicitly exempted`);
      assert.equal(issue?.requirements?.['engines.dsh'], '0.2.1-rc.2 || 0.2.1-rc.5', `${name}: ${version}`);
    }
  }
});
