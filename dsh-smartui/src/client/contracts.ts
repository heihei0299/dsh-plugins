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
  name: string; key?: string; id?: string; order?: number;
}
export interface ClientContext {
  effect(factory: () => Disposer): Disposer;
  slots: {
    inject(slot: string, register: () => Disposer): Disposer;
    register<P>(options: SlotOptions, component: ComponentType<P>): Disposer;
  };
  locale: LocaleService;
  configForms: { get<T extends SmartUISettings>(id: string): ConfigForm };
  theme: { overrideTokens(source: string, tokens: Record<string, { light: string; dark: string }>): Disposer };
}
