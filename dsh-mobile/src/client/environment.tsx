import * as React from 'react';
import { LOCALE_NS, readSettings, resolveEnabled, type MobileSettings } from '../shared/types.js';
import type { ClientContext, ConfigForm, ConfigSnapshot, Disposer, Translate } from './contracts.js';
import { COLLAPSED_ATTRIBUTE, FRAME } from './landmarks.js';

export interface Environment {
  ctx: ClientContext;
  form: ConfigForm;
  t: Translate;
}

export const EnvironmentContext = React.createContext<Environment | null>(null);

/** Live activation state, shared by the DOM reconciler and the drawer surface. */
export interface ActivationState {
  /** The mobile layout is installed right now. */
  active: boolean;
  /** Resolved settings while active, otherwise undefined. */
  settings: MobileSettings | undefined;
  /** The host reports the sidebar collapsed, i.e. the drawer is closed. */
  drawerClosed: boolean;
}

const INACTIVE: ActivationState = Object.freeze({ active: false, settings: undefined, drawerClosed: true });

export const ActivationContext = React.createContext<ActivationState>(INACTIVE);

export function useEnvironment(): Environment {
  const value = React.useContext(EnvironmentContext);
  if (value === null) throw new Error('dsh-mobile environment is not mounted');
  React.useSyncExternalStore(
    listener => value.ctx.locale.subscribe(listener),
    () => value.ctx.locale.getSnapshot(),
    () => value.ctx.locale.getSnapshot(),
  );
  return value;
}

export function useSettings(form: ConfigForm): ConfigSnapshot {
  return React.useSyncExternalStore(
    listener => form.subscribe(listener),
    () => form.getSnapshot(),
    () => form.getSnapshot(),
  );
}

/** Media query that identifies a touch-first pointer. */
export const COARSE_QUERY = '(pointer: coarse)';

export interface ActivationSource {
  subscribe(listener: () => void): Disposer;
  getSnapshot(): ActivationState;
}

/**
 * Single source of truth for "should the mobile layout be on", re-evaluated on
 * settings changes, rotation, window resizing and pointer-capability changes.
 *
 * Loading and unavailable settings resolve to inactive, so the first paint is
 * always the host's own layout rather than a half-applied one.
 * @param form - the plugin's ConfigForm.
 * @param attach - registers a teardown with the calling fiber.
 * @returns an external store React can subscribe to.
 */
export function createActivationSource(form: ConfigForm, attach: (factory: () => Disposer) => Disposer): ActivationSource {
  const listeners = new Set<() => void>();
  let cached = resolveNow();
  function facts(): { viewportWidth: number; coarsePointer: boolean } {
    return {
      viewportWidth: globalThis.innerWidth,
      coarsePointer: globalThis.matchMedia?.(COARSE_QUERY).matches === true,
    };
  }
  function resolveNow(): ActivationState {
    const snapshot = form.getSnapshot();
    const settings = snapshot.status === 'ready' ? readSettings(snapshot.value) : undefined;
    const active = settings !== undefined && resolveEnabled(settings, facts());
    return active ? { active, settings, drawerClosed: isDrawerClosed() } : INACTIVE;
  }
  function publish(): void {
    const next = resolveNow();
    if (next.active === cached.active && next.settings === cached.settings && next.drawerClosed === cached.drawerClosed) return;
    cached = next;
    for (const listener of listeners) listener();
  }
  const unsubscribeForm = form.subscribe(publish);
  globalThis.addEventListener('resize', publish);
  const media = globalThis.matchMedia?.(COARSE_QUERY);
  media?.addEventListener('change', publish);
  // The host owns the open/closed state; mirror it instead of tracking our own.
  const observer = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(publish);
  observer?.observe(document.documentElement, { subtree: true, attributeFilter: [COLLAPSED_ATTRIBUTE] });
  attach(() => () => {
    unsubscribeForm();
    globalThis.removeEventListener('resize', publish);
    media?.removeEventListener('change', publish);
    observer?.disconnect();
    listeners.clear();
  });
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => cached,
  };
}

/**
 * Read the host's sidebar state without writing it.
 * The frame sets `data-sidebar-collapsed` while collapsed; absent means open.
 * @returns true when the drawer should be treated as closed.
 */
export function isDrawerClosed(): boolean {
  const frame = document.querySelector(FRAME);
  return frame?.hasAttribute(COLLAPSED_ATTRIBUTE) !== false;
}

export function createEnvironment(ctx: ClientContext, form: ConfigForm): Environment {
  return { ctx, form, t: ctx.locale.bind(LOCALE_NS) };
}
