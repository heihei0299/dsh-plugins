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

/**
 * Compare resolved settings by value.
 *
 * `readSettings` intentionally sanitises the Host value, so it allocates a new
 * object on every read. Reference equality would therefore report a change on
 * every resize even when the settings never moved.
 * @param a - previously published settings.
 * @param b - newly resolved settings.
 * @returns true when every field matches.
 */
function sameSettings(a: MobileSettings | undefined, b: MobileSettings | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return a.mode === b.mode
    && a.drawerNavigation === b.drawerNavigation
    && a.comfortableTargets === b.comfortableTargets
    && a.swipeNavigation === b.swipeNavigation
    && a.rowActionsOnTouch === b.rowActionsOnTouch
    && a.quietComposerFocus === b.quietComposerFocus;
}

/**
 * Snapshot equality for React: settings by value, activation and drawer by value.
 * @param a - the published snapshot.
 * @param b - the freshly resolved one.
 * @returns true when subscribers would see no change.
 */
function sameState(a: ActivationState, b: ActivationState): boolean {
  return a.active === b.active && a.drawerClosed === b.drawerClosed && sameSettings(a.settings, b.settings);
}

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
    if (sameState(cached, next)) return;
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
 * Whether two snapshots need the same document-level installation.
 *
 * Drawer open/closed is deliberately absent: it only changes what React paints,
 * not the stylesheet, viewport meta, keyboard listener, gesture listeners or the
 * focus patch. `mode` is absent too, because it has already done its job by
 * deciding `active`. Every other field names something the installed effects are
 * built from — including the two interaction switches, which own listeners and a
 * prototype patch of their own and therefore must be rebuilt when they move.
 * @param a - the snapshot the document was built from.
 * @param b - the snapshot React just observed.
 * @returns true when the installed effects can stay untouched.
 */
function sameDocumentEffects(a: ActivationState, b: ActivationState): boolean {
  if (a.active !== b.active) return false;
  if (!a.active) return true;
  return a.settings?.drawerNavigation === b.settings?.drawerNavigation
    && a.settings?.comfortableTargets === b.settings?.comfortableTargets
    && a.settings?.rowActionsOnTouch === b.settings?.rowActionsOnTouch
    && a.settings?.swipeNavigation === b.settings?.swipeNavigation
    && a.settings?.quietComposerFocus === b.settings?.quietComposerFocus;
}

/**
 * Keep the document-level effects in step with an activation source.
 *
 * A drawer toggle wakes React through the source, but must not tear the
 * stylesheet down and rebuild it: that is the frame the host is already busy
 * animating. Only an activation flip or a change to the settings the installed
 * effects are built from causes a dispose/install pair, always in that order.
 * @param source - the activation store.
 * @param install - installs the effects for one active state.
 * @param attach - registers the teardown with the calling fiber.
 * @returns the teardown disposer.
 */
export function observeDocumentActivation(
  source: ActivationSource,
  install: (settings: MobileSettings) => Disposer,
  attach: (factory: () => Disposer) => Disposer,
): Disposer {
  return attach(() => {
    let disposeInstalled: Disposer | undefined;
    let installed: ActivationState | undefined;
    const reconcile = (): void => {
      const state = source.getSnapshot();
      if (installed !== undefined && sameDocumentEffects(installed, state)) return;
      disposeInstalled?.();
      disposeInstalled = undefined;
      installed = state;
      if (state.active && state.settings !== undefined) disposeInstalled = install(state.settings);
    };
    const unsubscribe = source.subscribe(reconcile);
    reconcile();
    return () => {
      unsubscribe();
      disposeInstalled?.();
      disposeInstalled = undefined;
      installed = undefined;
    };
  });
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
