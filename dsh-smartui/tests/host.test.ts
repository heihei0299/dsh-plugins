import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '@deepseek-ai/cordis';
import { createSmartUITool, apply } from '../src/host/index.js';
const document = { schemaVersion: 1, summary: 'Recorded summary', blocks: [{ id: 'card', type: 'card', body: 'Example content' }] };
test('Host tool declares canonical output, returns text fallback and persists full versioned metadata', async () => {
  const tool = createSmartUITool();
  // The body uses only signal; other execution fields are owned by the real DSH registry.
  const exec = { signal: new AbortController().signal } as Parameters<typeof tool.execute>[1];
  const value = await tool.execute({ document }, exec);
  assert.deepEqual(value, document);
  assert.deepEqual(tool.output.presentationMeta?.({ document }, value), { smartui: document });
  const content = tool.output.render({ document }, value);
  assert.ok(JSON.stringify(content).includes('Recorded summary'));
  assert.equal(tool.isConcurrencySafe?.({ document }), true);
});
test('Host disabled state and cancellation cannot admit a new UI document', async () => {
  const exec = { signal: new AbortController().signal } as Parameters<ReturnType<typeof createSmartUITool>['execute']>[1];
  await assert.rejects(createSmartUITool(() => false).execute({ document }, exec), /disabled/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createSmartUITool().execute({ document }, { ...exec, signal: controller.signal }));
});
test('Host registrations belong to effects and prompt follows live config without replacing assembly', () => {
  const disposers: (() => void)[] = []; let toolDisposed = false; let promptDisposed = false; let enabled = true;
  let section: { text: string | ((context: unknown) => string); complete?: boolean } | undefined;
  const ctx = {
    effect: (fn: () => () => void) => { const dispose = fn(); disposers.push(dispose); return dispose; },
    tools: { register: () => () => { toolDisposed = true; } },
    systemPrompt: { section: (value: typeof section) => { section = value; return () => { promptDisposed = true; }; } },
  } as unknown as Context;
  apply(ctx, { appearance: { get: () => 'chatgpt' }, enableComponents: { get: () => enabled } });
  assert.equal(disposers.length, 2); assert.equal(section?.complete, undefined);
  assert.equal(typeof section?.text, 'function');
  const text = section?.text as (context: unknown) => string;
  assert.match(text({}), /render_smart_ui/); enabled = false; assert.match(text({}), /disabled/);
  disposers.forEach(dispose => dispose()); assert.ok(toolDisposed && promptDisposed);
});
