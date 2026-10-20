import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COUNT_CAP, formatCount, jobCounts, NO_ROWS, subagentCounts } from '../src/client/status-source.js';

const root = { byId: { 'session-a': { running: false } } };

test('a session without a projected catalog has no subagent badge', () => {
  assert.deepEqual(subagentCounts({}, 'session-a'), NO_ROWS);
  assert.deepEqual(subagentCounts(root, 'session-a'), NO_ROWS);
  assert.deepEqual(subagentCounts({ ...root, projectionsBySession: { 'session-a': { values: {} } } }, 'session-a'), NO_ROWS);
  assert.deepEqual(subagentCounts({ ...root, projectionsBySession: { 'session-a': { values: { subagentCatalog: [] } } } }, 'session-a'), NO_ROWS);
});

test('an unwatched or unknown session reports nothing', () => {
  const snapshot = {
    byId: root.byId,
    projectionsBySession: { 'session-a': { values: { subagentCatalog: [{ id: 'child-1' }] } } },
  };
  assert.deepEqual(subagentCounts(snapshot, undefined), NO_ROWS);
  assert.deepEqual(subagentCounts(snapshot, 'session-unknown'), NO_ROWS);
});

test('subagent counts separate total children from running ones', () => {
  const snapshot = {
    byId: { 'session-a': {}, 'child-1': { running: true }, 'child-2': { running: false } },
    projectionsBySession: {
      'session-a': { values: { subagentCatalog: [{ id: 'child-1' }, { id: 'child-2' }, { id: 'child-3' }] } },
    },
  };
  assert.deepEqual(subagentCounts(snapshot, 'session-a'), { total: 3, live: true });
  // A child whose row is missing from byId is counted but never treated as running.
  const missing = {
    ...snapshot,
    projectionsBySession: { 'session-a': { values: { subagentCatalog: [{ id: 'child-9' }] } } },
  };
  assert.deepEqual(subagentCounts(missing, 'session-a'), { total: 1, live: false });
});

test('a subagent session never renders its own catalog badge', () => {
  const snapshot = {
    byId: { 'session-child': { origin: 'subagent' } },
    projectionsBySession: { 'session-child': { values: { subagentCatalog: [{ id: 'grandchild' }] } } },
  };
  assert.deepEqual(subagentCounts(snapshot, 'session-child'), NO_ROWS);
});

test('job counts treat completed, killed and failed rows as settled', () => {
  assert.deepEqual(jobCounts(undefined), NO_ROWS);
  assert.deepEqual(jobCounts([]), NO_ROWS);
  assert.deepEqual(jobCounts([{ id: 'job-1', status: 'completed' }]), { total: 1, live: false });
  assert.deepEqual(jobCounts([{ id: 'job-1', status: 'killed' }, { id: 'job-2', status: 'failed' }]), { total: 2, live: false });
  assert.deepEqual(jobCounts([{ id: 'job-1', status: 'running' }, { id: 'job-2', status: 'completed' }]), { total: 2, live: true });
  assert.deepEqual(jobCounts([{ id: 'job-1', status: 'stopping' }]), { total: 1, live: true });
});

test('counts cap at 9+ so the badge never reflows', () => {
  assert.equal(COUNT_CAP, 9);
  assert.equal(formatCount(0), '0');
  assert.equal(formatCount(1), '1');
  assert.equal(formatCount(9), '9');
  assert.equal(formatCount(10), '9+');
  assert.equal(formatCount(41), '9+');
  assert.equal(formatCount(Number.NaN), '0');
  assert.equal(formatCount(-3), '0');
  assert.equal(formatCount(3.7), '3');
});
