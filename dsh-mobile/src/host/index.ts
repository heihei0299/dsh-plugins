import type { Context, Volatile } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { DEFAULT_SETTINGS, type MobileSettings } from '../shared/types.js';

/**
 * Host half of @local/dsh-mobile.
 *
 * The plugin renders entirely in the browser; the only Host-side job is to
 * declare the `dsh-mobile` settings schema so the browser half can read and
 * write it through the existing ConfigForms transport. Every field is
 * `volatile()`, i.e. live-editable and applied without a Host restart.
 */
export interface PluginConfig {
  mode: Volatile<MobileSettings['mode']>;
  drawerNavigation: Volatile<boolean>;
  comfortableTargets: Volatile<boolean>;
  swipeNavigation: Volatile<boolean>;
  rowActionsOnTouch: Volatile<boolean>;
  quietComposerFocus: Volatile<boolean>;
}

export const Config = z.object({
  mode: z.union(['auto', 'on', 'off']).default(DEFAULT_SETTINGS.mode).description('Apply the mobile layout automatically on narrow/touch devices, always, or never').volatile(),
  drawerNavigation: z.boolean().default(DEFAULT_SETTINGS.drawerNavigation).description('Replace the permanent 56px sidebar rail with a drawer opened from a floating button').volatile(),
  comfortableTargets: z.boolean().default(DEFAULT_SETTINGS.comfortableTargets).description('Raise small icon controls to a 44px touch target').volatile(),
  swipeNavigation: z.boolean().default(DEFAULT_SETTINGS.swipeNavigation).description('Open the navigation drawer with a right swipe and close it with a left swipe').volatile(),
  rowActionsOnTouch: z.boolean().default(DEFAULT_SETTINGS.rowActionsOnTouch).description('Reveal the hover-only session and workspace row actions as touch targets').volatile(),
  quietComposerFocus: z.boolean().default(DEFAULT_SETTINGS.quietComposerFocus).description('Keep a programmatic composer focus from popping the on-screen keyboard').volatile(),
});

/** Provides no Host-side behaviour beyond the settings schema above. */
export function apply(_ctx: Context, _config: PluginConfig): void {
  // Intentionally empty: every effect lives in the browser bundle.
}
