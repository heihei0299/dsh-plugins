import * as React from 'react';
import type { MobileSettings } from '../shared/types.js';
import { useEnvironment, useSettings } from './environment.js';

/**
 * Settings row in Settings → General.
 *
 * Writes go through the host's ConfigForm (revision-checked, Host-persisted).
 * A refused or failed write never fakes success: the row keeps whatever the
 * last accepted snapshot says and shows why, matching the rest of the DSH
 * settings surface.
 * @returns the settings row.
 */
export function Settings() {
  const { t, form } = useEnvironment();
  const state = useSettings(form);
  const [pending, setPending] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const mounted = React.useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function set(field: keyof MobileSettings, value: string | boolean): Promise<void> {
    setPending(true); setNotice(null);
    try {
      const accepted = await form.set(field, value);
      if (mounted.current && !accepted) setNotice('settings.refused');
    } catch { if (mounted.current) setNotice('settings.error'); }
    finally { if (mounted.current) setPending(false); }
  }
  const disabled = state.status !== 'ready' || state.value === undefined || !state.writable || pending;
  const value = state.value;
  return <section className="dsh-mobile-settings" aria-label={t('settings.title')}>
    <div>
      <div className="dsh-mobile-setting-title">{t('settings.title')}</div>
      <p className="dsh-mobile-caption">{t('settings.description')}</p>
    </div>
    <label className="dsh-mobile-setting-row"><span>{t('settings.mode')}</span>
      <select disabled={disabled} value={value?.mode ?? 'auto'} onChange={event => { void set('mode', event.currentTarget.value); }}>
        <option value="auto">{t('settings.mode.auto')}</option>
        <option value="on">{t('settings.mode.on')}</option>
        <option value="off">{t('settings.mode.off')}</option>
      </select>
    </label>
    <label className="dsh-mobile-setting-row"><span>{t('settings.drawer')}</span>
      <select disabled={disabled} value={value?.drawerNavigation === false ? 'off' : 'on'} onChange={event => { void set('drawerNavigation', event.currentTarget.value === 'on'); }}>
        <option value="on">{t('settings.on')}</option>
        <option value="off">{t('settings.off')}</option>
      </select>
    </label>
    <label className="dsh-mobile-setting-row"><span>{t('settings.targets')}</span>
      <select disabled={disabled} value={value?.comfortableTargets === false ? 'off' : 'on'} onChange={event => { void set('comfortableTargets', event.currentTarget.value === 'on'); }}>
        <option value="on">{t('settings.on')}</option>
        <option value="off">{t('settings.off')}</option>
      </select>
    </label>
    <label className="dsh-mobile-setting-row"><span>{t('settings.swipe')}</span>
      <select disabled={disabled} value={value?.swipeNavigation === false ? 'off' : 'on'} onChange={event => { void set('swipeNavigation', event.currentTarget.value === 'on'); }}>
        <option value="on">{t('settings.on')}</option>
        <option value="off">{t('settings.off')}</option>
      </select>
    </label>
    <label className="dsh-mobile-setting-row"><span>{t('settings.rowActions')}</span>
      <select disabled={disabled} value={value?.rowActionsOnTouch === false ? 'off' : 'on'} onChange={event => { void set('rowActionsOnTouch', event.currentTarget.value === 'on'); }}>
        <option value="on">{t('settings.on')}</option>
        <option value="off">{t('settings.off')}</option>
      </select>
    </label>
    <label className="dsh-mobile-setting-row"><span>{t('settings.quietFocus')}</span>
      <select disabled={disabled} value={value?.quietComposerFocus === false ? 'off' : 'on'} onChange={event => { void set('quietComposerFocus', event.currentTarget.value === 'on'); }}>
        <option value="on">{t('settings.on')}</option>
        <option value="off">{t('settings.off')}</option>
      </select>
    </label>
    {(pending || notice !== null || state.status !== 'ready' || !state.writable) &&
      <p role="status" className={notice === null ? 'dsh-mobile-caption' : 'dsh-mobile-error'}>
        {t(pending ? 'settings.saving' : notice ?? (state.status === 'loading' ? 'settings.loading' : 'settings.unavailable'))}
      </p>}
  </section>;
}
