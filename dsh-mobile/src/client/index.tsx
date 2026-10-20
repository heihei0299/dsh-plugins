import * as React from 'react';
import en from '../../locale/en.json' with { type: 'json' };
import zh from '../../locale/zh.json' with { type: 'json' };
import { LOCALE_NS, SETTINGS_ID } from '../shared/types.js';
import { OVERLAY_SLOT } from './landmarks.js';
import { SETTINGS_STYLES } from './styles.js';
import type { ClientContext, Disposer } from './contracts.js';
import {
  ActivationContext, createActivationSource, createEnvironment, EnvironmentContext, type ActivationSource,
} from './environment.js';
import { installStyles } from './install-styles.js';
import { installViewport } from './install-viewport.js';
import { installKeyboardInset } from './install-keyboard.js';
import { DrawerScrim, DrawerToggle } from './Drawer.js';
import { Settings } from './Settings.js';

export const inject = ['slots', 'locale', 'configForms', 'layout'];

/** Style-tag identity for the settings row, which is styled even while inactive. */
const SETTINGS_STYLE_ID = '@local/dsh-mobile/settings.css';
/** Hoisted so every render passes the same props object. */
const SETTINGS_SLOT_OPTIONS = { name: 'settings.general.item', id: 'dsh-mobile', order: 85 } as const;
const OVERLAY_SLOT_OPTIONS = { name: OVERLAY_SLOT, id: 'dsh-mobile-drawer', order: 40 } as const;

/**
 * Install everything the active layout needs and return one disposer.
 *
 * Ordering matters: the stylesheet and the root attribute go on first so the
 * very first frame after activation is already the mobile layout, and the
 * keyboard/veport listeners are installed underneath a single teardown.
 * @param settings - resolved settings for this activation.
 * @returns a disposer restoring the document exactly.
 */
function activate(settings: { drawerNavigation: boolean; comfortableTargets: boolean }): Disposer {
  const restoreStyles = installStyles({ ...settings });
  const restoreViewport = installViewport();
  const restoreKeyboard = installKeyboardInset();
  return () => { restoreKeyboard(); restoreViewport(); restoreStyles(); };
}

/** Browser half: mobile layout, drawer surface and the settings row. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(LOCALE_NS, 'en', en.ui));
  ctx.effect(() => ctx.locale.register(LOCALE_NS, 'zh', zh.ui));

  const form = ctx.configForms.get(SETTINGS_ID);
  const environment = createEnvironment(ctx, form);
  const source: ActivationSource = createActivationSource(form, factory => ctx.effect(factory));

  // One reconciler owns every document-level write, so activation and
  // deactivation stay symmetric even when they interleave with a disposal.
  ctx.effect(() => {
    let disposeActive: Disposer | undefined;
    const reconcile = (): void => {
      disposeActive?.();
      disposeActive = undefined;
      const state = source.getSnapshot();
      if (!state.active || state.settings === undefined) return;
      disposeActive = activate(state.settings);
    };
    const unsubscribe = source.subscribe(reconcile);
    reconcile();
    return () => { unsubscribe(); disposeActive?.(); disposeActive = undefined; };
  });

  // The settings row must stay styled while the layout is off — it is how the
  // user turns it back on — so its sheet lives for the plugin's lifetime.
  ctx.effect(() => {
    const tag = document.createElement('style');
    tag.setAttribute('data-plugin-css', SETTINGS_STYLE_ID);
    tag.textContent = SETTINGS_STYLES;
    document.head.appendChild(tag);
    return () => { tag.remove(); };
  });

  function Surface({ children }: { children: React.ReactNode }) {
    const state = React.useSyncExternalStore(
      listener => source.subscribe(listener),
      () => source.getSnapshot(),
      () => source.getSnapshot(),
    );
    return <EnvironmentContext.Provider value={environment}>
      <ActivationContext.Provider value={state}>{children}</ActivationContext.Provider>
    </EnvironmentContext.Provider>;
  }
  function MobileOverlay(): React.ReactElement {
    return <Surface><DrawerScrim /><DrawerToggle /></Surface>;
  }
  function MobileSettings(): React.ReactElement {
    return <Surface><Settings /></Surface>;
  }

  ctx.slots.inject(OVERLAY_SLOT, () => ctx.slots.register(OVERLAY_SLOT_OPTIONS, MobileOverlay));
  ctx.slots.inject('settings.general.item', () => ctx.slots.register(SETTINGS_SLOT_OPTIONS, MobileSettings));
}
