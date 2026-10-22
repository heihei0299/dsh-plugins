import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChatFlowEntryLike, ChatFlowProps, ChatNodeSelector, ClientContext, ConversationViewNodeLike, SlotOptions } from '../src/client/contracts.js';
import { createProseProjection, installProseVisibility, proseNodeSelector } from '../src/client/prose-visibility.js';

function assistant(step: number, blocks: unknown[], extra: Partial<ConversationViewNodeLike> = {}): ConversationViewNodeLike {
  return Object.freeze({
    key: `assistant:${step}`, kind: 'assistant-step', id: String(step), target: 'chat',
    anchorSeq: step * 10, location: { kind: 'unresolved' as const }, visibility: 'visible' as const,
    data: Object.freeze({ step, status: 'settled', blocks: Object.freeze(blocks) }), ...extra,
  });
}

function nodeHook(nodes: ReadonlyMap<string, ConversationViewNodeLike>): ChatNodeSelector {
  return <Result = ConversationViewNodeLike | undefined>(key: string, select?: (node: ConversationViewNodeLike | undefined) => Result): Result => {
    const node = nodes.get(key);
    return select === undefined ? node as Result : select(node);
  };
}

test('the main plan and a later supplement both stay at Turn level without changing source Nodes', () => {
  const plan = assistant(1, [{ kind: 'text', text: 'Main plan, before background research completes.' }]);
  const supplement = assistant(3, [{ kind: 'text', text: 'Research complete; the plan above is unchanged.' }]);
  const project = createProseProjection();
  for (const node of [plan, supplement]) {
    const visible = project(node)!;
    assert.equal(visible.groupTree, 'turn');
    assert.notEqual(visible, node);
    assert.equal(visible.data, node.data);
    assert.equal(visible.key, node.key);
    assert.equal(visible.anchorSeq, node.anchorSeq);
    assert.equal(visible.location, node.location);
    assert.equal(node.groupTree, undefined);
  }
});

test('tools, pure reasoning, empty text and unrelated rows retain their original folding input', () => {
  const project = createProseProjection();
  const nodes = [
    assistant(1, [{ kind: 'reasoning', text: 'Thinking' }]),
    assistant(2, [{ kind: 'tool-call', name: 'bash' }]),
    assistant(3, [{ kind: 'text', text: ' \n ' }]),
    assistant(4, [{ kind: 'text', text: 'Tool output' }], { kind: 'tool-call' }),
    assistant(5, [{ kind: 'text', text: 'User prompt' }], { kind: 'user' }),
    assistant(6, [{ kind: 'text', text: 'Already outside' }], { groupTree: 'exchange' }),
    assistant(7, [{ kind: 'text', text: 'Already outside' }], { groupTree: 'input' }),
    assistant(8, [{ kind: 'text', text: 'Already outside' }], { groupTree: 'turn' }),
    assistant(9, [], { data: null }),
  ];
  assert.equal(project(undefined), undefined);
  for (const node of nodes) assert.equal(project(node), node);
});

test('mixed replies keep the original reasoning/tool blocks for native process grouping', () => {
  const blocks = [
    { kind: 'reasoning', text: 'Research reasoning' },
    { kind: 'text', text: 'The actual plan' },
    { kind: 'tool-call', name: 'subagent' },
  ];
  const node = assistant(1, blocks);
  const projected = createProseProjection()(node)!;
  assert.equal(projected.groupTree, 'turn');
  assert.equal(projected.data, node.data);
  assert.equal((projected.data as { blocks: unknown[] }).blocks[0], blocks[0]);
  // Chat grouping still reads `node`, not `projected`. Reasoning belongs to its
  // native process-group container; only the root response seat sees this copy.
  assert.equal(node.groupTree, undefined);
});

test('images and other native reply blocks remain visible without a text heuristic', () => {
  for (const kind of ['image', 'other']) assert.equal(createProseProjection()(assistant(1, [{ kind }]))?.groupTree, 'turn');
});

test('immutable Node caching preserves selector identity and follows streaming snapshots', () => {
  const streaming = assistant(1, [{ kind: 'text', text: 'Plan' }], { data: { status: 'running', blocks: [{ kind: 'text', text: 'Plan' }] } });
  const settled = assistant(1, [{ kind: 'text', text: 'Plan complete' }]);
  const nodes = new Map([[streaming.key, streaming]]);
  const useVisible = proseNodeSelector(nodeHook(nodes));
  const first = useVisible(streaming.key);
  assert.equal(useVisible(streaming.key), first);
  assert.equal(useVisible(streaming.key, node => node?.data), streaming.data);
  nodes.set(settled.key, settled);
  const next = useVisible(settled.key);
  assert.notEqual(next, first);
  assert.equal(next?.data, settled.data);
  assert.equal(useVisible('missing'), undefined);
});

function slotHost(initial: ChatFlowEntryLike[] = []) {
  const entries = [...initial];
  const listeners = new Set<() => void>();
  let registrations = 0;
  const ctx: Pick<ClientContext, 'slots'> = { slots: {
    inject: (_name, factory) => factory(),
    entries: () => [...entries].sort((a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0)),
    subscribe: (_name, listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    register: <Props>(options: SlotOptions, component: React.ComponentType<Props>) => {
      const entry: ChatFlowEntryLike = { options, component: component as unknown as React.ComponentType<ChatFlowProps>,
        locale: options.locale, store: options.store, children: options.children, inject: options.inject };
      registrations++;
      entries.push(entry);
      return () => { const index = entries.indexOf(entry); if (index !== -1) entries.splice(index, 1); };
    },
  } };
  return { ctx, entries, listeners, registrations: () => registrations, flush: () => { for (const listener of listeners) listener(); } };
}

function nativeEntry(component: React.ComponentType<ChatFlowProps> = () => null): ChatFlowEntryLike {
  return Object.freeze({ options: { name: 'conversation.chat.flow', priority: 100 }, component,
    locale: 'chat', store: {}, children: { 'conversation.chat.node': { kind: 'keyed', scope: 'session' } }, inject: () => ({ native: true }) });
}

test('the native flow keeps its Store, locale, child declarations and injected capabilities', () => {
  const source = nativeEntry();
  const host = slotHost([source]);
  const dispose = installProseVisibility(host.ctx);
  const wrapper = host.entries.find(entry => entry !== source)!;
  assert.equal(wrapper.options.priority, 99);
  for (const key of ['locale', 'store', 'children', 'inject'] as const) assert.equal(wrapper[key], source[key]);
  host.flush(); host.flush();
  assert.equal(host.registrations(), 1, 'self-registration must not recursively wrap itself');
  dispose(); dispose();
  assert.deepEqual(host.entries, [source]);
  assert.equal(host.listeners.size, 0);
});

test('late registration, native flow replacement and removal follow the slot lifetime', () => {
  const host = slotHost();
  const dispose = installProseVisibility(host.ctx);
  assert.equal(host.registrations(), 0);
  const first = nativeEntry();
  host.entries.push(first); host.flush();
  assert.equal(host.entries.length, 2);
  const second = nativeEntry();
  host.entries.splice(host.entries.indexOf(first), 1, second); host.flush();
  assert.equal(host.entries.length, 2);
  assert.equal(host.registrations(), 2);
  host.entries.splice(host.entries.indexOf(second), 1); host.flush();
  assert.equal(host.entries.length, 0);
  dispose();
  assert.equal(host.listeners.size, 0);
});

test('the wrapper delegates to the existing renderer and forwards other props unchanged', () => {
  const plan = assistant(1, [{ kind: 'text', text: 'Plan' }]);
  const useChatNode = nodeHook(new Map([[plan.key, plan]]));
  const inputActions = {};
  let received: ChatFlowProps & { inputActions?: unknown } | undefined;
  const source = nativeEntry(props => {
    received = props;
    return React.createElement('span', null, props.useChatNode(plan.key)?.groupTree);
  });
  const host = slotHost([source]);
  const dispose = installProseVisibility(host.ctx);
  const Wrapper = host.entries.find(entry => entry !== source)!.component;
  const props = { useChatNode, inputActions };
  assert.equal(renderToStaticMarkup(React.createElement(Wrapper, props)), '<span>turn</span>');
  assert.equal(received?.inputActions, inputActions);
  assert.equal(received?.useChatNode(plan.key)?.data, plan.data);
  assert.equal(useChatNode(plan.key), plan);
  dispose();
});
