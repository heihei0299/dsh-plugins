import type { Context, Volatile } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { DEFAULT_SETTINGS, type MobileSettings } from '../shared/types.js';

/**
 * Host half of @local/dsh-mobile.
 *
 * The plugin renders entirely in the browser; the only Host-side job is to
 * declare the `dsh-mobile` settings schema so the browser half can read and
 * write it through the existing ConfigForms transport. All three fields are
 * `volatile()`, i.e. live-editable and applied without a Host restart.
 */
export interface PluginConfig {
  mode: Volatile<MobileSettings['mode']>;
  drawerNavigation: Volatile<boolean>;
  comfortableTargets: Volatile<boolean>;
}

export const Config = z.object({
  mode: z.union(['auto', 'on', 'off']).default(DEFAULT_SETTINGS.mode).description('Apply the mobile layout automatically on narrow/touch devices, always, or never').volatile(),
  drawerNavigation: z.boolean().default(DEFAULT_SETTINGS.drawerNavigation).description('Replace the permanent 56px sidebar rail with a drawer opened from a floating button').volatile(),
  comfortableTargets: z.boolean().default(DEFAULT_SETTINGS.comfortableTargets).description('Raise small icon controls to a 44px touch target').volatile(),
});

/** Provides no Host-side behaviour beyond the settings schema above. */
export function apply(_ctx: Context, _config: PluginConfig): void {
  // Intentionally empty: every effect lives in the browser bundle.
}
