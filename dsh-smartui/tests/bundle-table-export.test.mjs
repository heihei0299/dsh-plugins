import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

/**
 * Behaviour of the delivered artifact, observed the way a user triggers it.
 *
 * `dist/client.js` is what DSH loads; the `src/` tests only prove intent. This
 * test runs the real loader bundle inside a host-shaped sandbox, renders the
 * registered conversation row through a minimal React harness, chooses the
 * export format with the real `<select>`, clicks the real copy button and
 * asserts the text handed to `navigator.clipboard.writeText`.
 *
 * It never reaches into bundle internals by function name or line number: both
 * formats are exercised through component props and state, so a bundle built
 * from different source still has to behave correctly at this boundary. Run
 * `pnpm run build` first; a stale or missing `dist/` fails here on purpose.
 */

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));

/* ---------------------------------------------------------------------- *
 * Minimal React harness for the sandboxed bundle.
 *
 * The bundle imports `react` from the host, so the test decides what React
 * means here. Function components render through a hook store keyed by tree
 * position; class components keep their instance; effects run after a pass and
 * a pass repeats until state settles.
 * ---------------------------------------------------------------------- */

const FRAGMENT = Symbol('smartui-test-fragment');
let dispatch = null;
let effectQueue = [];
let nextTestId = 0;

function createElement(type, props, ...children) {
  const next = { ...(props ?? {}) };
  if (children.length === 1) next.children = children[0];
  else if (children.length > 1) next.children = children;
  return { type, props: next, key: next.key ?? null };
}

function createContext(defaultValue) {
  const context = { defaultValue };
  context.Provider = { context };
  return context;
}

class Component {
  constructor(props) { this.props = props; }
  setState() { throw new Error('The table export harness never expects setState'); }
}
Component.prototype.isReactComponent = {};

function sameDependencies(previous, next) {
  if (!previous || !next || previous.length !== next.length) return false;
  return previous.every((value, index) => Object.is(value, next[index]));
}

function useContext(context) {
  for (let index = dispatch.contexts.length - 1; index >= 0; index -= 1) {
    const entry = dispatch.contexts[index];
    if (entry.context === context) return entry.value;
  }
  return context.defaultValue;
}

function useState(initial) {
  const frame = dispatch;
  const slot = frame.index++;
  const hook = (frame.hooks[slot] ??= { state: typeof initial === 'function' ? initial() : initial });
  const schedule = frame.schedule;
  return [hook.state, value => {
    const next = typeof value === 'function' ? value(hook.state) : value;
    if (Object.is(next, hook.state)) return;
    hook.state = next;
    schedule();
  }];
}

function useRef(initial) {
  const frame = dispatch;
  const slot = frame.index++;
  return (frame.hooks[slot] ??= { current: initial });
}

function useMemo(factory, deps) {
  const frame = dispatch;
  const slot = frame.index++;
  const hook = frame.hooks[slot];
  if (hook && sameDependencies(hook.deps, deps)) return hook.value;
  const value = factory();
  frame.hooks[slot] = { deps: deps ? [...deps] : undefined, value };
  return value;
}

function useEffect(effect, deps) {
  const frame = dispatch;
  const slot = frame.index++;
  const hook = (frame.hooks[slot] ??= { deps: undefined, cleanup: undefined });
  if (deps && hook.deps && sameDependencies(hook.deps, deps)) return;
  hook.deps = deps ? [...deps] : undefined;
  frame.effects.push(() => {
    hook.cleanup?.();
    const cleanup = effect();
    hook.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
  });
}

function useId() {
  const frame = dispatch;
  const slot = frame.index++;
  const hook = (frame.hooks[slot] ??= { id: `smartui-test-${nextTestId += 1}` });
  return hook.id;
}

function useSyncExternalStore(_subscribe, getSnapshot) {
  dispatch.index += 1;
  return getSnapshot();
}

const react = {
  Fragment: FRAGMENT,
  Component,
  createElement,
  createContext,
  useContext,
  useState,
  useRef,
  useMemo,
  useEffect,
  useId,
  useSyncExternalStore,
};

function createRenderer() {
  const hookStore = new Map();
  const instances = new Map();
  let rootElement = null;
  let nodes = [];
  let dirty = false;

  function renderChild(child, path, contexts, out) {
    if (child === null || child === undefined || typeof child === 'boolean') return;
    if (Array.isArray(child)) {
      child.forEach((item, index) => renderChild(item, `${path}.${index}`, contexts, out));
      return;
    }
    if (typeof child === 'string' || typeof child === 'number') {
      out.push({ kind: 'text', value: String(child) });
      return;
    }
    out.push(renderElement(child, path, contexts));
  }

  function renderChildren(children, path, contexts) {
    const out = [];
    renderChild(children, path, contexts, out);
    return out;
  }

  function renderElement(element, path, contexts) {
    const type = element.type;
    if (type === FRAGMENT) {
      return { kind: 'fragment', children: renderChildren(element.props.children, `${path}:fragment`, contexts) };
    }
    if (type && typeof type === 'object' && 'context' in type) {
      const value = element.props.value;
      return { kind: 'provider', children: renderChildren(element.props.children, `${path}:provider`, [...contexts, { context: type.context, value }]) };
    }
    if (typeof type === 'function' && type.prototype?.isReactComponent) {
      const key = `${path}|${String(element.key ?? '')}|${type.name}`;
      const instance = instances.get(key) ?? new type(element.props);
      instance.props = element.props;
      instances.set(key, instance);
      return { kind: 'class', type, children: renderChildren(instance.render(), `${path}:class`, contexts) };
    }
    if (typeof type === 'function') {
      const key = `${path}|${String(element.key ?? '')}|${type.name}`;
      const hooks = hookStore.get(key) ?? [];
      hookStore.set(key, hooks);
      const previous = dispatch;
      dispatch = { hooks, index: 0, contexts, effects: effectQueue, schedule: () => { dirty = true; } };
      let rendered;
      try {
        rendered = type(element.props);
      } finally {
        dispatch = previous;
      }
      return { kind: 'component', type, children: renderChildren(rendered, `${path}:fn`, contexts) };
    }
    return { kind: 'host', type, props: element.props, children: renderChildren(element.props.children, `${path}:host`, contexts) };
  }

  function renderPass() {
    effectQueue = [];
    const out = [];
    renderChild(rootElement, 'root', [], out);
    const queued = effectQueue;
    effectQueue = [];
    nodes = out;
    for (const run of queued) run();
  }

  function flush() {
    for (let pass = 0; ; pass += 1) {
      if (pass > 20) throw new Error('The table export harness did not settle');
      dirty = false;
      renderPass();
      if (!dirty) return;
    }
  }

  function* each(list = nodes) {
    for (const node of list) {
      yield node;
      if (node.children?.length) yield* each(node.children);
    }
  }

  return {
    mount(element) {
      rootElement = element;
      flush();
    },
    hosts(predicate) {
      return [...each()].filter(node => node.kind === 'host' && predicate(node));
    },
    click(handler) {
      handler();
      flush();
    },
  };
}

/* ---------------------------------------------------------------------- *
 * Loader bundle, host-shaped sandbox and the export fixture.
 * ---------------------------------------------------------------------- */

const tableBlock = {
  id: 'values',
  type: 'table',
  title: 'Values',
  columns: [{ id: 'label', label: 'Label' }, { id: 'value', label: 'Value' }],
  rows: [
    ['plain text', -2],
    ['-2', '=1+1'],
    ['\t+SUM(A1)', null],
    [0, -1.5],
    ['', null],
  ],
};
const document = { schemaVersion: 1, summary: 'Export fixture', blocks: [tableBlock] };
const expectedTsv = [
  'Label\tValue',
  'plain text\t-2',
  "'-2\t'=1+1",
  "' +SUM(A1)\t—",
  '0\t-1.5',
  '\t—',
].join('\n');
const expectedCsv = [
  '"Label","Value"',
  '"plain text","-2"',
  '"\'-2","\'=1+1"',
  // CSV keeps the embedded tab; only TSV flattens it to a space.
  '"\'\t+SUM(A1)","—"',
  '"0","-1.5"',
  '"","—"',
].join('\r\n');

/** Load the real loader bundle the way the host does and mount its chat row. */
async function openTable() {
  let source;
  try {
    source = await readFile(new URL('dist/client.js', root), 'utf8');
  } catch (error) {
    throw new Error(`dist/client.js is unreadable (${error.code ?? error.message}); run "pnpm run build" before this test`);
  }
  const clipboard = [];
  const styleTags = [];
  const documentStub = {
    head: { append(style) { style.isConnected = true; styleTags.push(style); } },
    createElement() {
      return {
        isConnected: false, attributes: {}, textContent: '',
        setAttribute(name, value) { this.attributes[name] = value; },
        remove() { this.isConnected = false; },
      };
    },
    querySelector() { return styleTags.find(style => style.isConnected) ?? null; },
  };
  let registration;
  const sandbox = {
    window: { __ModuleLoader__: { load(value) { assert.equal(registration, undefined, 'the bundle registers once'); registration = value; } } },
    document: documentStub,
    navigator: { clipboard: { writeText(text) { clipboard.push(text); } } },
    TextEncoder,
    TextDecoder,
  };
  runInNewContext(source, sandbox, { timeout: 5_000 });
  assert.equal(registration?.id, manifest.name, 'the loader bundle names its package');
  const plugin = registration.factory(name => {
    assert.equal(name, 'react', 'the client must ask the host for React only');
    return react;
  });

  const settings = { status: 'ready', value: { appearance: 'chatgpt', enableComponents: true }, writable: true, revision: 1 };
  const locale = { active: 'en', revision: 0 };
  const slots = new Map();
  const noop = () => {};
  const dispose = () => {};
  const ctx = {
    effect(factory) { const disposer = factory(); return typeof disposer === 'function' ? disposer : dispose; },
    locale: { register: dispose, bind: () => key => key, getSnapshot: () => locale, subscribe: () => noop },
    configForms: { get: () => ({ getSnapshot: () => settings, subscribe: () => noop, set: async () => false }) },
    theme: { overrideTokens: () => dispose },
    uiConversation: { events: { register: dispose } },
    slots: {
      inject(_name, factory) { factory(); return dispose; },
      register(options, component) {
        slots.set(`${options.name}:${options.key ?? options.id}`, component);
        return dispose;
      },
    },
  };
  plugin.apply(ctx);
  const ChatRow = slots.get('conversation.chat.node:smartui-document');
  assert.equal(typeof ChatRow, 'function', 'the conversation row is registered');

  const renderer = createRenderer();
  renderer.mount(createElement(ChatRow, {
    sessionId: 'session',
    node: { key: 'smartui-document:call', kind: 'smartui-document', id: 'call', data: { callId: 'call', document } },
    inputActions: {
      captureInsertion: () => ({ start: 0, end: 0, draftRev: 0 }),
      insertText() { throw new Error('Exporting a table must not write to the draft'); },
    },
    useInput: selector => selector({ phase: 'plain', draft: '' }),
  }));
  return { renderer, clipboard };
}

/** Copy the table exactly as the user does: the default format, or one picked from the select. */
async function copyTable({ renderer, clipboard }, format) {
  const select = renderer.hosts(node => node.type === 'select');
  assert.equal(select.length, 1, 'the table has exactly one export format select');
  assert.deepEqual(select[0].children.filter(node => node.kind === 'host' && node.type === 'option').map(node => node.props.value), ['tsv', 'csv', 'markdown']);
  if (format === 'tsv') {
    // The default path: TSV without touching the format control.
    assert.equal(select[0].props.value, 'tsv', 'TSV is the format a user gets without choosing one');
  } else {
    renderer.click(() => select[0].props.onChange({ currentTarget: { value: format } }));
    assert.equal(renderer.hosts(node => node.type === 'select')[0].props.value, format, 'the select reflects the chosen format');
  }
  const copyRoot = renderer.hosts(node => node.type === 'div' && node.props.className === 'smartui-copy');
  assert.equal(copyRoot.length, 1, 'the table renders one copy control');
  const button = copyRoot[0].children.find(node => node.kind === 'host' && node.type === 'button');
  assert.equal(typeof button?.props.onClick, 'function', 'the copy control has a click handler');
  renderer.click(() => button.props.onClick({}));
  await new Promise(resolve => setTimeout(resolve, 0));
  return clipboard;
}

test('the delivered bundle keeps typed numbers raw in TSV and still neutralizes text formulas', async () => {
  const opened = await openTable();
  const clipboard = await copyTable(opened, 'tsv');
  assert.equal(clipboard.length, 1, 'the copy button writes to the clipboard once');
  assert.equal(clipboard[0], expectedTsv);
});

test('the delivered bundle keeps typed numbers raw in CSV and still neutralizes text formulas', async () => {
  const opened = await openTable();
  const clipboard = await copyTable(opened, 'csv');
  assert.equal(clipboard.length, 1, 'the copy button writes to the clipboard once');
  assert.equal(clipboard[0], expectedCsv);
});
