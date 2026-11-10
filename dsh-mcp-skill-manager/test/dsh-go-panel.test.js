import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDshGoPanel } from '../lib/dsh-go/panel.js';
import { buildView } from '../lib/dsh-go/view.js';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-skill-panel-'));
  let policy = { version: 1, projects: [] };
  let fail = false;
  const calls = [];
  const store = {
    platform: process.platform,
    displayFile: '/tmp/mcp-skill-manager.json',
    getPolicy: () => policy,
    getError: () => null,
    getWarnings: () => []
  };
  const manager = {
    async savePolicy(next) {
      calls.push(next);
      if (fail) throw new Error('disk full');
      policy = next;
      return { policy, warnings: [] };
    }
  };
  const ctx = {
    tools: {
      definitions: () => [{ name: 'mcp__alpha__one', description: 'alpha tool' }]
    }
  };
  const panel = createDshGoPanel({ ctx, manager, store });
  return {
    dir,
    panel,
    store,
    manager,
    calls,
    getPolicy: () => policy,
    setFail: (value) => { fail = value; },
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  };
}

const caps = {
  locale: 'zh-CN',
  components: ['stack', 'text', 'list', 'form', 'textField', 'options', 'actions', 'confirm', 'keyValue', 'divider', 'callout']
};

async function tick() {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

test('builds a v2 form view and a form-free v1 fallback', () => {
  const { panel } = fixture();
  const v2 = panel.view({}, caps);
  assert.equal(v2.v, 2);
  const form = v2.children.find((node) => node.type === 'form');
  assert.ok(form);
  assert.equal(form.submit.id, 'add-project');
  assert.equal(form.children[0].type, 'textField');
  assert.equal(form.children[0].bind, 'data.form.path');
  assert.equal(form.children[0].onChange, 'form-change');

  const v1 = buildView({ locale: 'en-US', components: ['stack', 'list'] });
  assert.equal(v1.v, 1);
  assert.equal(JSON.stringify(v1).includes('"form"'), false);
  assert.equal(JSON.stringify(v1).includes('"textField"'), false);
});

test('adds, selects, toggles, and removes a project through native actions', async () => {
  const f = fixture();
  const emissions = [];
  const cleanup = f.panel.data({ sessionId: 's1' }, (data) => emissions.push(data), caps);
  await tick();

  const added = await f.panel.actions['add-project'](
    { sessionId: 's1' },
    { locale: 'zh-CN', value: { values: { 'data.form.path': f.dir, 'data.form.label': 'Demo' } } }
  );
  assert.equal(added.pending.label, '正在保存…');
  const addedResult = await added.result();
  assert.match(addedResult.toast, /已保存/);
  assert.equal(f.getPolicy().projects.length, 1);
  assert.equal(f.getPolicy().projects[0].label, 'Demo');
  assert.equal(f.getPolicy().projects[0].path, f.dir);

  const selected = f.panel.actions['select-project']({ sessionId: 's1' }, { locale: 'zh-CN', value: { index: 0 } });
  assert.ok(selected.patch.projectRows[0].title);

  await tick();
  const toggled = f.panel.actions['toggle-mcp']({ sessionId: 's1' }, { locale: 'zh-CN', value: { name: 'alpha' } });
  assert.ok(toggled.pending);
  await toggled.result();
  assert.equal(f.getPolicy().projects[0].mcp.mode, 'selected');
  assert.deepEqual(f.getPolicy().projects[0].mcp.servers, []);

  const removed = f.panel.actions['remove-project']({ sessionId: 's1' }, { locale: 'zh-CN', value: { confirmed: false } });
  assert.match(removed.toast, /取消/);
  const confirmed = f.panel.actions['remove-project']({ sessionId: 's1' }, { locale: 'zh-CN', value: { confirmed: true } });
  assert.ok(confirmed.pending);
  await confirmed.result();
  assert.equal(f.getPolicy().projects.length, 0);
  assert.ok(Array.isArray(emissions.at(-1).projectRows));

  cleanup();
  f.cleanup();
});

test('a failed save keeps the previous policy and reports a toast', async () => {
  const f = fixture();
  const cleanup = f.panel.data({ sessionId: 's2' }, () => {}, caps);
  await tick();
  const added = await f.panel.actions['add-project'](
    { sessionId: 's2' },
    { locale: 'zh-CN', value: { values: { 'data.form.path': f.dir, 'data.form.label': 'Demo' } } }
  );
  await added.result();
  f.setFail(true);
  const toggled = f.panel.actions['toggle-mcp']({ sessionId: 's2' }, { locale: 'zh-CN', value: { name: 'alpha' } });
  const result = await toggled.result();
  assert.match(result.toast, /保存失败/);
  assert.equal(f.getPolicy().projects[0].mcp.mode, 'all');
  cleanup();
  f.cleanup();
});
