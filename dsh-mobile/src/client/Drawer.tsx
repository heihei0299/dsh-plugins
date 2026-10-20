import * as React from 'react';
import { ActivationContext, useEnvironment } from './environment.js';

/**
 * Floating navigation control for the drawer layout.
 *
 * The host keeps ownership of the sidebar state: this only calls
 * `ctx.layout.toggleSidebar()`, the same action the host's own collapse button
 * and Mod+B shortcut use. Rendered into the frame-wide overlay layer, which is
 * click-through until a child opts back into pointer events.
 * @returns the toggle button, or nothing while the mobile layout is inactive.
 */
export function DrawerToggle() {
  const { ctx, t } = useEnvironment();
  const activation = React.useContext(ActivationContext);
  if (!activation.active || activation.settings?.drawerNavigation !== true) return null;
  const label = activation.drawerClosed ? t('nav.open') : t('nav.close');
  return <button type="button" className="dsh-mobile-toggle" aria-label={label} title={label}
    aria-expanded={!activation.drawerClosed} aria-controls="dsh-mobile-drawer"
    onClick={() => { ctx.layout.toggleSidebar(); }}>
    <DrawerGlyph closed={activation.drawerClosed} />
  </button>;
}

/**
 * Scrim behind the open drawer; tapping it closes the drawer through the same
 * host action, so no separate state can drift.
 *
 * It stays MOUNTED for the plugin's lifetime and is driven purely by opacity,
 * for two reasons: mounting a full-viewport element is exactly the kind of work
 * that lands on the frame the host is already blocking while it rebuilds the
 * sidebar, and an always-mounted layer keeps the compositor's layer for the scrim
 * warm so a fade never has to allocate one. `visibility` (not `display`) keeps it
 * out of hit-testing while closed without discarding the layer.
 * @returns the scrim button, or nothing while the mobile layout is inactive.
 */
export function DrawerScrim() {
  const { ctx, t } = useEnvironment();
  const activation = React.useContext(ActivationContext);
  const enabled = activation.active && activation.settings?.drawerNavigation === true;
  if (!enabled) return null;
  const open = !activation.drawerClosed;
  return <button type="button" className="dsh-mobile-scrim" aria-label={t('nav.close')} tabIndex={-1}
    aria-hidden={open ? undefined : 'true'}
    data-open={open ? '' : undefined}
    onClick={() => { ctx.layout.toggleSidebar(); }} />;
}

function DrawerGlyph({ closed }: { closed: boolean }) {
  return <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true" focusable="false">
    {closed
      ? <path d="M3 4.5h12M3 9h12M3 13.5h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      : <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
  </svg>;
}
