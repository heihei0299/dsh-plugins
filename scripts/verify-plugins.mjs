#!/usr/bin/env node
/**
 * Run the existing offline checks in a source-to-artifact order.
 * This builds dist/ in the selected plugin directories; it never installs dependencies.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const plugins = ['pin-subagent-model', 'dsh-history-budget', 'dsh-mobile', 'dsh-smartui', 'dsh-lan-connect'];

/** Build a fixed command plan; plugin names are not interpreted as shell input. */
export function verificationPlan(requested = []) {
  const selected = requested.length ? [...new Set(requested)] : plugins;
  for (const name of selected) {
    if (!plugins.includes(name)) throw new Error(`Unknown plugin: ${name}`);
  }
  const plan = [{ label: 'bundle metadata', cwd: root, command: process.execPath, args: ['scripts/check-bundles.mjs', ...selected] }];
  const add = (name, label, command, ...args) => plan.push({ label: `${name}: ${label}`, cwd: path.join(root, name), command, args });
  for (const name of selected) {
    if (name === 'pin-subagent-model' || name === 'dsh-history-budget') {
      add(name, 'test', process.execPath, '--test', '--test-concurrency=1');
      continue;
    }
    if (name === 'dsh-mobile' || name === 'dsh-smartui') add(name, 'typecheck', 'pnpm', 'run', 'typecheck');
    // Build explicitly instead of trusting a pretest hook or an existing dist/.
    add(name, 'build', 'pnpm', 'run', 'build');
    add(name, 'test', 'pnpm', 'test');
    // The LAN test suite already includes its verify:bundle test.
    if (name !== 'dsh-lan-connect') add(name, 'verify bundle', 'pnpm', 'run', 'verify:bundle');
  }
  return plan;
}

/** Run sequentially so that a failing stage cannot be mistaken for a passed gate. */
export function runPlan(plan, runner = spawnSync) {
  for (const step of plan) {
    console.log(`\n=== ${step.label} ===`);
    const result = runner(step.command, step.args, { cwd: step.cwd, stdio: 'inherit' });
    if (result.error) throw new Error(`${step.label}: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`${step.label} failed${result.signal ? ` (${result.signal})` : ` (exit ${result.status})`}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const requested = process.argv.slice(2);
  if (requested.includes('--help')) {
    console.log(`Usage: node scripts/verify-plugins.mjs [${plugins.join(' | ')} ...]\nBuilds and runs offline checks without installing dependencies. The selected dist/ directories will be overwritten.`);
  } else {
    try {
      runPlan(verificationPlan(requested));
      console.log('\nSelected plugin checks passed. Check for optional test skips; live-browser acceptance remains separate.');
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
