/**
 * Opt-in regression test against a real DSH runtime.
 *
 * A stubbed registry cannot prove the Host contract, so this test mounts the
 * built Host bundle into an actual `@deepseek-ai/cordis` context running the
 * shipped `@deepseek-ai/dsh-system-prompt` and `@deepseek-ai/dsh-tools`
 * services, dispatches `render_smart_ui` through the real tool pipeline, and
 * unloads the plugin again.
 *
 * It is skipped unless `DSH_TEST_RUNTIME_ROOT` names one or more DSH package
 * roots — the installed `@deepseek-ai/dsh` directory, or an overlay whose
 * `node_modules` resolves it — separated by the platform path delimiter. Every
 * root is exercised separately and reports the `dsh-tools` version it covers,
 * so one run can check each supported release (rc.2 and rc.5).
 *
 * The test reads no profile or credential, opens no socket, and uses no network:
 * the composition is a bare Cordis context plus the two services the Host
 * injects.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SUPPORTED_RUNTIMES = new Set(['0.2.1-rc.2', '0.2.1-rc.5', '0.2.2-rc.1']);
const TOOL_NAME = 'render_smart_ui';
const hostEntry = new URL('../dist/host/index.js', import.meta.url);
const roots = (process.env.DSH_TEST_RUNTIME_ROOT ?? '').split(delimiter).map(root => root.trim()).filter(Boolean);
const document = {
  schemaVersion: 1,
  summary: 'Runtime integration summary',
  blocks: [
    { id: 'card', type: 'card', body: 'Mount once, execute once' },
    { id: 'callout', type: 'callout', body: 'Unloaded with its effect', tone: 'neutral' },
  ],
};

/** Resolve a bare specifier as the runtime root sees it, then import it as ESM. */
const resolveIn = (root, specifier) => createRequire(join(root, 'package.json')).resolve(specifier);
const importIn = async (root, specifier) => import(pathToFileURL(resolveIn(root, specifier)).href);
const versionIn = (root, name) => JSON.parse(readFileSync(resolveIn(root, `${name}/package.json`), 'utf8')).version;

if (roots.length === 0) {
  test('render_smart_ui integrates with a real DSH runtime', {
    skip: 'set DSH_TEST_RUNTIME_ROOT=<DSH package root>[:<another root>] to run the native runtime regression',
  }, () => {});
}

for (const root of roots) {
  let installed;
  try {
    installed = versionIn(root, '@deepseek-ai/dsh-tools');
  } catch (error) {
    test(`runtime root ${root} resolves @deepseek-ai/dsh-tools`, () => {
      assert.fail(`cannot resolve @deepseek-ai/dsh-tools from ${root}: ${error.message}`);
    });
    continue;
  }
  test(`render_smart_ui mounts, executes and unloads in the real dsh-tools ${installed} runtime`, async t => {
    assert.ok(SUPPORTED_RUNTIMES.has(installed), `${root} ships an unsupported @deepseek-ai/dsh-tools ${installed}`);
    assert.ok(existsSync(hostEntry), `missing ${hostEntry.pathname}; build the Host bundle first (pnpm run build)`);

    const { Context } = await importIn(root, '@deepseek-ai/cordis');
    const prompt = await importIn(root, '@deepseek-ai/dsh-system-prompt');
    const { default: ToolRuntime } = await importIn(root, '@deepseek-ai/dsh-tools');
    const { apply } = await import(hostEntry.href);
    assert.equal(typeof Context, 'function', 'cordis exports its Context constructor');
    assert.equal(typeof prompt.renderPrompt, 'function', 'system-prompt exports renderPrompt');

    // A bare context carries nothing: the two services the Host injects come
    // from the runtime under test, not from this repository.
    const ctx = new Context();
    const promptFork = await ctx.plugin(prompt.default, {});
    const toolsFork = await ctx.plugin(ToolRuntime, { mode: 'native' });
    t.after(async () => {
      await toolsFork.dispose();
      await promptFork.dispose();
    });
    assert.deepEqual(ctx.tools.schemas(), [], 'the fresh registry starts empty');

    // Mount the Host exactly as the loader would: Volatile config accessors plus
    // the declared `inject`, so `ctx.effect`, `ctx.tools` and `ctx.systemPrompt`
    // are the real service instances.
    let enabled = true;
    const pluginFork = await ctx.plugin({
      inject: ['tools', 'systemPrompt'],
      apply: context => apply(context, {
        appearance: { get: () => 'chatgpt' },
        enableComponents: { get: () => enabled },
      }),
    });

    const schemas = ctx.tools.schemas();
    assert.deepEqual(schemas.map(schema => schema.name), [TOOL_NAME]);
    assert.deepEqual(Object.keys(schemas[0].parameters.properties), ['document']);
    assert.equal(ctx.tools.get(TOOL_NAME)?.output !== undefined, true, 'the registry sees the output contract');
    assert.match(prompt.renderPrompt(await ctx.systemPrompt.assemble()), new RegExp(TOOL_NAME));

    const signal = new AbortController().signal;
    const result = await ctx.tools.execute({ callId: 'smartui-1', name: TOOL_NAME, arguments: { document }, signal });

    assert.equal(result.isError, false, 'the pipeline accepts a valid document');
    assert.deepEqual(result.value, document);
    assert.deepEqual(result.meta, { smartui: document }, 'presentationMeta reaches the result meta');
    assert.match(JSON.stringify(result.content), /Runtime integration summary/);
    assert.match(JSON.stringify(result.content), new RegExp(`${document.blocks.length} blocks`));
    assert.deepEqual(ctx.tools.executionMode({ callId: 'smartui-2', name: TOOL_NAME, arguments: { document }, signal }), { kind: 'parallel' });

    const rejected = await ctx.tools.execute({
      callId: 'smartui-3', name: TOOL_NAME, arguments: { document: { ...document, extra: true } }, signal,
    });
    assert.equal(rejected.isError, true, 'the registry rejects an undeclared document field');
    assert.match(JSON.stringify(rejected.content), /additionalProperties/);

    enabled = false;
    assert.match(prompt.renderPrompt(await ctx.systemPrompt.assemble()), /disabled/);
    const disabled = await ctx.tools.execute({ callId: 'smartui-4', name: TOOL_NAME, arguments: { document }, signal });
    assert.equal(disabled.isError, true, 'the live Volatile config gates execution');
    assert.match(JSON.stringify(disabled.content), /disabled/);

    // Unloading the plugin must withdraw both registrations it owns.
    await pluginFork.dispose();
    assert.equal(ctx.tools.get(TOOL_NAME), undefined);
    assert.deepEqual(ctx.tools.schemas(), []);
    assert.doesNotMatch(prompt.renderPrompt(await ctx.systemPrompt.assemble()), new RegExp(TOOL_NAME));
  });
}
