import * as React from 'react';
import type { ChatFlowEntryLike, ChatFlowProps, ChatNodeSelector, ClientContext, ConversationViewNodeLike, Disposer } from './contracts.js';

const FLOW_SLOT = 'conversation.chat.flow';

function hasReply(node: ConversationViewNodeLike): boolean {
  if (typeof node.data !== 'object' || node.data === null) return false;
  const blocks = (node.data as Record<string, unknown>).blocks;
  return Array.isArray(blocks) && blocks.some((block: unknown) => {
    if (typeof block !== 'object' || block === null) return false;
    const value = block as Record<string, unknown>;
    if (value.kind === 'text') return typeof value.text === 'string' && value.text.trim() !== '';
    return value.kind === 'image' || value.kind === 'other';
  });
}

/**
 * Project only the renderer's view of native assistant replies to Turn level.
 * The source Node and its grouping input are untouched: Chat still splits each
 * assistant into a process-owned reasoning part and a root response part. Its
 * process-group container continues to hide reasoning and tools, while the root
 * response seat is no longer hidden by the whole-Turn disclosure.
 * Cache by immutable source identity so field selectors and streaming keep the
 * native subscription behavior. No text is copied or rendered a second time.
 */
export function createProseProjection() {
  const cache = new WeakMap<ConversationViewNodeLike, ConversationViewNodeLike>();
  return (node: ConversationViewNodeLike | undefined): ConversationViewNodeLike | undefined => {
    if (node === undefined || node.kind !== 'assistant-step' || node.groupTree === 'turn'
      || node.groupTree === 'input' || node.groupTree === 'exchange' || !hasReply(node)) return node;
    let projected = cache.get(node);
    if (projected === undefined) {
      projected = { ...node, groupTree: 'turn' };
      cache.set(node, projected);
    }
    return projected;
  };
}

/** Wrap the public keyed hook; pass selectors through the native subscription. */
export function proseNodeSelector(useChatNode: ChatNodeSelector): ChatNodeSelector {
  const project = createProseProjection();
  return <Result = ConversationViewNodeLike | undefined>(
    key: string, select?: (node: ConversationViewNodeLike | undefined) => Result,
  ): Result => useChatNode(key, node => {
    const visible = project(node);
    return select === undefined ? visible as Result : select(visible);
  });
}

/**
 * Shadow the flow through the public Slot API and delegate to its existing
 * component with one projected hook. Retain the native injection, children,
 * locale and Store; never mutate the host registry entries or Session history.
 * Observe registration lifetimes so late registration/replacement and disabling
 * this bundle restore the native flow without monkey-patching a host method.
 */
export function installProseVisibility(ctx: Pick<ClientContext, 'slots'>): Disposer {
  return ctx.slots.inject(FLOW_SLOT, () => {
    let source: ChatFlowEntryLike | undefined;
    let wrapper: React.ComponentType<ChatFlowProps> | undefined;
    let disposeFlow: Disposer | undefined;
    let disposed = false;
    const reconcile = () => {
      if (disposed) return;
      const next = ctx.slots.entries(FLOW_SLOT).find(entry => entry.component !== wrapper);
      if (next === source) return;
      disposeFlow?.();
      disposeFlow = undefined;
      source = next;
      if (next === undefined) return;
      const NativeFlow = next.component;
      wrapper = function ProseVisibleFlow(props: ChatFlowProps) {
        const useChatNode = React.useMemo(() => proseNodeSelector(props.useChatNode), [props.useChatNode]);
        return React.createElement(NativeFlow, { ...props, useChatNode });
      };
      disposeFlow = ctx.slots.register({
        ...next.options,
        name: FLOW_SLOT,
        priority: (next.options.priority ?? 0) - 1,
        locale: next.locale,
        store: next.store,
        children: next.children,
        inject: next.inject,
      }, wrapper);
    };
    const unsubscribe = ctx.slots.subscribe(FLOW_SLOT, reconcile);
    try { reconcile(); } catch (error) { disposed = true; unsubscribe(); disposeFlow?.(); throw error; }
    return () => {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      disposeFlow?.();
    };
  });
}
