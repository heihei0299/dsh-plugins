import * as React from 'react';
import en from '../../locale/en.json' with { type: 'json' };
import zh from '../../locale/zh.json' with { type: 'json' };
import { LOCALE_NS, SETTINGS_ID } from '../shared/types.js';
import { HEADER_LEADING_SLOT, OVERLAY_SLOT } from './landmarks.js';
import { SETTINGS_STYLES } from './styles.js';
import type { ClientContext, Disposer } from './contracts.js';
import {
  ActivationContext, createActivationSource, createEnvironment, EnvironmentContext,
  observeDocumentActivation, type ActivationSource,
} from './environment.js';
import { installStyles } from './install-styles.js';
import { installViewport } from './install-viewport.js';
import { installKeyboardInset } from './install-keyboard.js';
import { DrawerFallbackToggle, DrawerScrim, DrawerToggle } from './Drawer.js';
import { Settings } from './Settings.js';
import { StatusBadges } from './StatusBadges.js';

export const inject = ['slots', 'locale', 'configForms', 'layout', 'sessions', 'jobs', 'uiWorkspace'];

/** Style-tag identity for the settings row, which is styled even while inactive. */
const SETTINGS_STYLE_ID = '@local/dsh-mobile/settings.css';
/** Hoisted so every render passes the same props object. */
const SETTINGS_SLOT_OPTIONS = { name: 'settings.general.item', id: 'dsh-mobile', order: 85 } as const;
const OVERLAY_SLOT_OPTIONS = { name: OVERLAY_SLOT, id: 'dsh-mobile-drawer', order: 40 } as const;
/** The host's own subagent and job badges live in this slot; ours replaces them. */
const HEADER_ACTIONS_SLOT = 'conversation.session.header.actions';
const HEADER_ACTIONS_SLOT_OPTIONS = { name: HEADER_ACTIONS_SLOT, id: 'dsh-mobile-status', order: 5 } as const;

/**
 * Install everything the active layout needs and return one disposer.
 *
 * Ordering matters: the stylesheet and the root attribute go on first so the
 * very first frame after activation is already the mobile layout, and the
 * keyboard/veport listeners are installed underneath a single teardown.
 *
 * The drawer's motion needs no JavaScript at all: it is a pair of CSS rules that
 * copy the host's own `sidebar-right` transition, so the browser schedules it
 * exactly like the shipped panel next door.
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
  // Drawer open/closed changes are React-only and never reach this effect.
  observeDocumentActivation(source, activate, factory => ctx.effect(factory));

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
      source.subscribe,
      source.getSnapshot,
      source.getSnapshot,
    );
    return <EnvironmentContext.Provider value={environment}>
      <ActivationContext.Provider value={state}>{children}</ActivationContext.Provider>
    </EnvironmentContext.Provider>;
  }
  function MobileScrim(): React.ReactElement {
    return <Surface><DrawerScrim /><DrawerFallbackToggle /></Surface>;
  }
  function MobileToggle(): React.ReactElement {
    return <Surface><DrawerToggle /></Surface>;
  }
  function MobileSettings(): React.ReactElement {
    return <Surface><Settings /></Surface>;
  }
  function MobileBadges(props: { sessionId?: string }): React.ReactElement {
    return <Surface><StatusBadges sessionId={props.sessionId} /></Surface>;
  }

  // The toggle takes the header's own leading seat, so the session title starts
  // after it instead of being covered by a floating button.
  ctx.slots.inject(HEADER_LEADING_SLOT, () => ctx.slots.register({ name: HEADER_LEADING_SLOT }, MobileToggle));
  // The scrim has to cover the whole frame, so it stays in the floating layer.
  ctx.slots.inject(OVERLAY_SLOT, () => ctx.slots.register(OVERLAY_SLOT_OPTIONS, MobileScrim));
  // Same documented slot the host's own subagent/job badges use; the sheet
  // retires a host badge only while its compact replacement is rendered.
  ctx.slots.inject(HEADER_ACTIONS_SLOT, () => ctx.slots.register(HEADER_ACTIONS_SLOT_OPTIONS, MobileBadges));
  ctx.slots.inject('settings.general.item', () => ctx.slots.register(SETTINGS_SLOT_OPTIONS, MobileSettings));
}
