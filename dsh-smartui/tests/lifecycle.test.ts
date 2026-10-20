import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAppearance, CHATGPT_TOKENS } from '../src/client/theme.js';
import { toolModel } from '../src/client/tool-model.js';
import type { ConfigForm, ConfigSnapshot } from '../src/client/contracts.js';
test('theme layers follow accepted Host settings, preserve user theme, and dispose exactly once', () => {
  let snapshot: ConfigSnapshot = { status: 'loading', value: undefined, writable: false, revision: undefined };
  const listeners = new Set<() => void>(); let installs = 0; let disposals = 0;
  const form: ConfigForm = { getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, set: async () => false };
  const dispose = installAppearance({ theme: { overrideTokens: (_source, tokens) => { assert.equal(tokens, CHATGPT_TOKENS); installs++; return () => { disposals++; }; } } }, form);
  assert.equal(installs, 0);
  const set = (value: ConfigSnapshot['value']) => { snapshot = { status: 'ready', value, writable: true, revision: 1 }; for (const listener of listeners) listener(); };
  set({ appearance: 'chatgpt', enableComponents: true }); assert.equal(installs, 1);
  set({ appearance: 'chatgpt', enableComponents: false }); assert.equal(installs, 1); assert.equal(disposals, 0);
  set({ appearance: 'native', enableComponents: true }); assert.equal(disposals, 1);
  set({ appearance: 'chatgpt', enableComponents: true }); assert.equal(installs, 2);
  dispose(); assert.equal(disposals, 2); assert.equal(listeners.size, 0);
});
test('all theme overrides declare both palette modes and only alias tokens', () => {
  for (const [key, modes] of Object.entries(CHATGPT_TOKENS)) { assert.ok(key.startsWith('--dsw-alias-')); assert.ok(modes.light); assert.ok(modes.dark); }
});
test('tool phases do not trust streaming arguments or failed result metadata', () => {
  assert.equal(toolModel({ phase: 'preparing', block: {} }).state, 'preparing');
  assert.equal(toolModel({ phase: 'start', block: {} }).state, 'running');
  const meta = { smartui: { schemaVersion: 1, summary: 'Ready', blocks: [{ id: 'card', type: 'card', body: 'Text' }] } };
  assert.equal(toolModel({ phase: 'result', block: { meta } }).state, 'document');
  assert.equal(toolModel({ phase: 'result', block: { meta, isError: true } }).state, 'failed');
  assert.equal(toolModel({ phase: 'result', block: { meta, error: { code: 'CANCELLED' } } }).state, 'failed');
  assert.equal(toolModel({ phase: 'result', block: { meta: { smartui: { schemaVersion: 2 } }, content: [{ type: 'text', text: 'Summary preserved' }] } }).text, 'Summary preserved');
});
