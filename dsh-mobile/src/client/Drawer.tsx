import * as React from 'react';
import { ActivationContext, isDrawerClosed, useEnvironment } from './environment.js';
import { DRAWER_ID, installDrawerInteraction, installDrawerTarget } from './install-drawer.js';

/**
 * Header navigation control for the drawer layout.
 *
 * The host keeps ownership of the sidebar state: this only calls
 * `ctx.layout.toggleSidebar()`, the same action the host's own collapse button
 * and Mod+B shortcut use. It occupies the header's leading seat.
 * @returns the toggle button, or nothing while the mobile layout is inactive.
 */
export function DrawerToggle({ floating = false }: { floating?: boolean } = {}) {
  const { ctx, t } = useEnvironment();
  const activation = React.useContext(ActivationContext);
  if (!activation.active || activation.settings?.drawerNavigation !== true) return null;
  const label = activation.drawerClosed ? t('nav.open') : t('nav.close');
  return <button type="button" className={floating ? 'dsh-mobile-toggle dsh-mobile-toggle-fallback' : 'dsh-mobile-toggle'} aria-label={label} title={label}
    aria-expanded={!activation.drawerClosed} aria-controls={DRAWER_ID} aria-haspopup="dialog"
    onClick={() => { ctx.layout.toggleSidebar(); }}>
    <DrawerGlyph closed={activation.drawerClosed} />
  </button>;
}

/** Global panels have no conversation header: retain a way to reopen navigation. */
export function DrawerFallbackToggle() {
  const { ctx } = useEnvironment();
  const panel = React.useSyncExternalStore(
    listener => ctx.layout.panelInfo.subscribe(listener),
    () => ctx.layout.panelInfo.getSnapshot(),
    () => ctx.layout.panelInfo.getSnapshot(),
  );
  return panel.activePanelId === null ? null : <DrawerToggle floating />;
}

/**
 * Scrim behind the open drawer; tapping it closes the drawer through the same
 * host action, so no separate state can drift.
 *
 * It stays mounted across drawer toggles while drawer navigation is enabled.
 * Opacity and delayed visibility keep the closing scrim in hit-testing until
 * the slide finishes; repeated taps during that exit must not reopen the drawer.
 * @returns the scrim button, or nothing while the mobile layout is inactive.
 */
export function DrawerScrim() {
  const { ctx, t } = useEnvironment();
  const activation = React.useContext(ActivationContext);
  const enabled = activation.active && activation.settings?.drawerNavigation === true;
  const open = !activation.drawerClosed;
  const label = t('nav.label');
  React.useLayoutEffect(() => enabled ? installDrawerTarget() : undefined, [enabled]);
  React.useLayoutEffect(() => enabled && open ? installDrawerInteraction(ctx, label) : undefined, [enabled, open, ctx, label]);
  if (!enabled) return null;
  return <button type="button" className="dsh-mobile-scrim" aria-label={t('nav.close')} tabIndex={-1}
    aria-hidden={open ? undefined : 'true'}
    data-open={open ? '' : undefined}
    onClick={() => { if (open && !isDrawerClosed()) ctx.layout.toggleSidebar(); }} />;
}

function DrawerGlyph({ closed }: { closed: boolean }) {
  return <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true" focusable="false">
    {closed
      ? <path d="M3 4.5h12M3 9h12M3 13.5h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      : <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
  </svg>;
}
