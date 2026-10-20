/** Settings and identity shared by the Host entry and the browser bundle. */

/** Where the mobile layout applies. `auto` needs a narrow viewport or a coarse pointer. */
export type MobileMode = 'auto' | 'on' | 'off';

export interface MobileSettings {
  mode: MobileMode;
  /** Replace the permanent 56px sidebar rail with a drawer opened from a floating button. */
  drawerNavigation: boolean;
  /** Raise small icon controls to a 44px touch target. */
  comfortableTargets: boolean;
}

/** Host plugin entry id, also the ConfigForm id the browser reads. */
export const SETTINGS_ID = 'dsh-mobile';
/** Locale namespace registered by the browser half. */
export const LOCALE_NS = 'dsh-mobile';
/** Document-root attribute scoping every rule this plugin injects. */
export const ROOT_ATTRIBUTE = 'data-dsh-mobile';
/** Treat viewports at or below this width as narrow (matches the host's own rail rail-off decision). */
export const NARROW_BREAKPOINT = 720;

export const DEFAULT_SETTINGS: Readonly<MobileSettings> = Object.freeze({
  mode: 'auto',
  drawerNavigation: true,
  comfortableTargets: true,
});

/**
 * Narrow an untrusted ConfigForm value onto the settings shape.
 * Unknown modes and non-booleans fall back to their defaults rather than throwing,
 * so a profile patched by hand cannot break the browser half.
 * @param value - the Host-provided section, possibly partial.
 * @returns complete settings.
 */
export function readSettings(value: unknown): MobileSettings {
  const section = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
  const mode = section.mode;
  return {
    mode: mode === 'on' || mode === 'off' || mode === 'auto' ? mode : DEFAULT_SETTINGS.mode,
    drawerNavigation: typeof section.drawerNavigation === 'boolean' ? section.drawerNavigation : DEFAULT_SETTINGS.drawerNavigation,
    comfortableTargets: typeof section.comfortableTargets === 'boolean' ? section.comfortableTargets : DEFAULT_SETTINGS.comfortableTargets,
  };
}

/** Viewport facts that decide the automatic mode. */
export interface EnvironmentFacts {
  viewportWidth: number;
  /** `(pointer: coarse)` — touch screens, including touch laptops. */
  coarsePointer: boolean;
}

/**
 * Decide whether the mobile layout applies.
 * `on`/`off` are absolute; `auto` requires a narrow viewport or a coarse pointer.
 * @param settings - resolved settings.
 * @param facts - live viewport facts.
 * @returns true when the layout should be installed.
 */
export function resolveEnabled(settings: MobileSettings, facts: EnvironmentFacts): boolean {
  if (settings.mode === 'off') return false;
  if (settings.mode === 'on') return true;
  return facts.viewportWidth <= NARROW_BREAKPOINT || facts.coarsePointer;
}
