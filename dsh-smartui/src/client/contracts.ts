import type { ComponentType } from 'react';
import type { SmartUISettings } from '../shared/types.js';
/** Narrow structural boundary from the installed DSH 0.2.1-rc.2 public declarations.
 * No runtime imports of internal Harness Client packages. See docs/compatibility.md. */
export type Disposer = () => void;
export interface InsertionSpan { start: number; end: number; draftRev: number }
export interface InputActions {
  captureInsertion(): InsertionSpan;
  insertText(text: string, span: InsertionSpan): boolean;
}
export interface InputSnapshot { draft: string; phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting'; claim?: unknown }
/** Minimal view of the Session snapshot the dock slot already receives.
 * `blank` is true only while the Session has no accepted turn, which is when
 * starting suggestions are useful. */
export interface SessionSnapshotLike { blank?: boolean; running?: boolean }
export type Selector<T> = <R>(select: (snapshot: T) => R) => R;
export interface SessionProps {
  sessionId: string; inputActions: InputActions; useInput: Selector<InputSnapshot>;
  session?: SessionSnapshotLike | undefined;
}
export interface ToolViewProps extends SessionProps {
  callId: string; toolName: string; phase: 'preparing' | 'start' | 'result';
  block: { meta?: unknown; content?: unknown; isError?: boolean; error?: unknown };
  inspect?: () => void;
}
export interface ConfigSnapshot {
  status: 'loading' | 'ready' | 'unavailable'; value: SmartUISettings | undefined;
  writable: boolean; revision: number | undefined;
}
export interface ConfigForm {
  getSnapshot(): ConfigSnapshot;
  subscribe(listener: () => void): Disposer;
  set(field: keyof SmartUISettings, value: unknown): Promise<boolean>;
}
export type Translate = (key: string, values?: Record<string, string | number>) => string;
export interface LocaleSnapshot { active: string; revision: number }
export interface LocaleService {
  register(ns: string, locale: string, dict: Record<string, string>): Disposer;
  bind(ns: string): Translate;
  getSnapshot(): LocaleSnapshot;
  subscribe(listener: () => void): Disposer;
}
export interface SlotOptions {
  name: string; key?: string; id?: string; order?: number; priority?: number;
  locale?: string; store?: unknown; children?: Readonly<Record<string, unknown>>; inject?: unknown;
}
/** Public Slot registry entry fields needed to wrap, not replace, the native flow. */
export interface ChatFlowEntryLike {
  options: SlotOptions;
  component: ComponentType<ChatFlowProps>;
  locale?: string; store?: unknown; children?: Readonly<Record<string, unknown>>; inject?: unknown;
}
/** Native keyed snapshot hook, including its optional field selector. */
export type ChatNodeSelector = <Result = ConversationViewNodeLike | undefined>(
  key: string, select?: (node: ConversationViewNodeLike | undefined) => Result,
) => Result;
export interface ChatFlowProps { useChatNode: ChatNodeSelector }
/** Structural slice of one durable or transient Session event. */
export interface SessionEventLike { type: string; seq: number; data?: unknown }
export interface TurnLocationLike { turn: number; status: 'open' | 'closed' | 'unknown'; steps: readonly unknown[]; data: unknown }
export type ConversationLocationLike =
  | { kind: 'session' }
  | { kind: 'turn'; turn: TurnLocationLike }
  | { kind: 'step'; turn: TurnLocationLike; step: unknown }
  | { kind: 'unresolved' };
export interface ConversationMatchLike { event: SessionEventLike; role: 'start' | 'update'; location: ConversationLocationLike }
export interface ConversationNodeContextLike<State> {
  key: string; kind: string; id: string;
  matches: readonly ConversationMatchLike[];
  start: ConversationMatchLike | undefined;
  state: State | undefined;
  current: ReadonlyMap<string, unknown>;
}
export interface ConversationMatchResultLike { id: string; role: 'start' | 'update'; exclusive?: true }
/** Read-only row published by one Conversation Definition for a Chat target. */
export interface ConversationViewNodeLike {
  key: string; kind: string; id: string; target: string;
  anchorSeq: number; location: ConversationLocationLike;
  visibility: 'visible' | 'hidden';
  groupTree?: 'exchange' | 'input' | 'turn' | 'process';
  data: unknown;
}
/** Minimal Event-to-Node state machine accepted by `uiConversation.events`. */
export interface ConversationNodeDefinition<State> {
  kind: string; target?: string;
  match(event: SessionEventLike): ConversationMatchResultLike | null;
  start(context: ConversationNodeContextLike<State>, match: ConversationMatchLike): State;
  update(context: ConversationNodeContextLike<State> & { state: State }, match: ConversationMatchLike): State;
  buildViewNode(context: ConversationNodeContextLike<State>): ConversationViewNodeLike | null;
}
/** Keyed Chat row this plugin renders outside the foldable process group. */
export interface ChatNodeProps extends SessionProps {
  node: { key: string; kind: string; id: string; data: unknown };
}
export interface ClientContext {
  effect(factory: () => Disposer): Disposer;
  slots: {
    inject(slot: string, register: () => Disposer): Disposer;
    register<P>(options: SlotOptions, component: ComponentType<P>): Disposer;
    entries(name: 'conversation.chat.flow'): readonly ChatFlowEntryLike[];
    subscribe(name: 'conversation.chat.flow', listener: () => void): Disposer;
  };
  locale: LocaleService;
  configForms: { get<T extends SmartUISettings>(id: string): ConfigForm };
  theme: { overrideTokens(source: string, tokens: Record<string, { light: string; dark: string }>): Disposer };
  /** Conversation Definition registry; the only official way to add a durable Chat row. */
  uiConversation: { events: { register<State>(definition: ConversationNodeDefinition<State>): Disposer } };
}
