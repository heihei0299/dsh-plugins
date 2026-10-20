import type { ComponentType } from 'react';
import type { MobileSettings } from '../shared/types.js';

/**
 * Structural boundary to the installed DSH 0.2.1-rc.2 browser contracts.
 * No runtime import of any Harness Client package: the bundle only requires the
 * host `react` module (see scripts/verify-bundle.mjs). See README for the exact
 * boundary and docs/compatibility for how it is re-checked on a dsh upgrade.
 */
export type Disposer = () => void;

export interface ConfigSnapshot {
  status: 'loading' | 'ready' | 'unavailable';
  value: MobileSettings | undefined;
  writable: boolean;
  revision: number | undefined;
}

export interface ConfigForm {
  getSnapshot(): ConfigSnapshot;
  subscribe(listener: () => void): Disposer;
  set(field: keyof MobileSettings, value: unknown): Promise<boolean>;
}

export interface Translate {
  (key: string, values?: Record<string, string | number>): string;
}

export interface LocaleSnapshot {
  active: string;
  revision: number;
}

export interface LocaleService {
  register(ns: string, locale: string, dict: Record<string, string>): Disposer;
  bind(ns: string): Translate;
  getSnapshot(): LocaleSnapshot;
  subscribe(listener: () => void): Disposer;
}

export interface SlotOptions {
  name: string;
  key?: string;
  id?: string;
  order?: number;
}

/** Read-only host source; navigation ownership remains with the host. */
export interface HostSource<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): Disposer;
}

/** `ctx.layout` face this plugin uses: the host still owns every geometry decision. */
export interface LayoutService {
  readonly panelInfo: HostSource<{ readonly activePanelId: string | null }>;
  toggleSidebar(): void;
}

/** The same public main-view ownership projection used by the host's session tree. */
export interface SessionsService {
  readonly list: HostSource<{
    readonly byId: Readonly<Record<string, {
      readonly retainedBy: { readonly mainView?: number };
      readonly running?: boolean;
      readonly origin?: string;
    }>>;
    readonly projectionsBySession?: Readonly<Record<string, {
      readonly values: { readonly subagentCatalog?: readonly { readonly id: string; readonly label?: string }[] };
    } | undefined>>;
  }>;
}

/** `ctx.jobs` face: the reference-counted background-job rosters. */
export interface JobsService {
  readonly state: HostSource<{
    readonly rows: Readonly<Record<string, readonly { readonly id: string; readonly label?: string; readonly status: string; readonly progress?: string }[]>>;
  }>;
  watchRows(sessionId: string): Disposer;
}

/** `ctx.uiWorkspace` face used to jump to a subagent's conversation. */
export interface WorkspaceService {
  openSession(target: string): void;
}

export interface ClientContext {
  effect(factory: () => Disposer): Disposer;
  slots: {
    inject(slot: string, register: () => Disposer): Disposer;
    register<P>(options: SlotOptions, component: ComponentType<P>): Disposer;
  };
  locale: LocaleService;
  configForms: { get(id: string): ConfigForm };
  layout: LayoutService;
  sessions: SessionsService;
  jobs: JobsService;
  /** Present whenever the host's workspace UI is loaded; navigation is skipped without it. */
  uiWorkspace?: WorkspaceService;
}
