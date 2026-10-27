import assert from 'node:assert/strict';
import test from 'node:test';
import { runPlan, verificationPlan } from './verify-plugins.mjs';

test('selects only known plugins and deduplicates them', () => {
  const plan = verificationPlan(['dsh-lan-connect', 'dsh-lan-connect']);
  assert.deepEqual(plan[0].args.slice(1), ['dsh-lan-connect']);
  assert.deepEqual(plan.slice(1).map(step => step.label), ['dsh-lan-connect: build', 'dsh-lan-connect: test']);
  assert.throws(() => verificationPlan(['not-a-plugin']), /Unknown plugin/);
});

test('each built plugin builds before its tests and artifact verification', () => {
  const plan = verificationPlan();
  for (const name of ['dsh-mobile', 'dsh-smartui', 'dsh-lan-connect']) {
    const labels = plan.map(step => step.label);
    const build = labels.indexOf(`${name}: build`);
    const tests = labels.indexOf(`${name}: test`);
    assert.ok(build >= 0 && build < tests, name);
    const bundle = labels.indexOf(`${name}: verify bundle`);
    if (bundle >= 0) assert.ok(tests < bundle, name);
  }
  assert.ok(plan.some(step => step.label === 'pin-subagent-model: test'));
  assert.ok(plan.some(step => step.label === 'dsh-history-budget: test'));
});

test('a failing command stops the remaining steps', () => {
  const plan = verificationPlan(['dsh-lan-connect']);
  const calls = [];
  assert.throws(() => runPlan(plan, (command, args, options) => {
    calls.push({ command, args, options });
    return { status: calls.length === 2 ? 1 : 0 };
  }), /dsh-lan-connect: build failed/);
  assert.equal(calls.length, 2);
});
