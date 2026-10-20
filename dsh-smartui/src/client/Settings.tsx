import * as React from 'react';
import type { SmartUISettings } from '../shared/types.js';
import { useEnvironment, useSettings } from './environment.js';
export function Settings() {
  const { t, form } = useEnvironment(); const state = useSettings(form);
  const [pending, setPending] = React.useState(false); const [notice, setNotice] = React.useState<string | null>(null);
  const mounted = React.useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function set(field: keyof SmartUISettings, value: string | boolean) {
    setPending(true); setNotice(null);
    try {
      const accepted = await form.set(field, value);
      if (mounted.current && !accepted) setNotice('settings.refused');
    } catch { if (mounted.current) setNotice('settings.error'); }
    finally { if (mounted.current) setPending(false); }
  }
  const disabled = state.status !== 'ready' || !state.value || !state.writable || pending;
  return <section className="smartui-settings" aria-label={t('settings.title')}>
    <div><div className="smartui-setting-title">{t('settings.title')}</div><p className="smartui-caption">{t('settings.description')}</p></div>
    <label className="smartui-setting-row"><span>{t('settings.appearance')}</span><select disabled={disabled} value={state.value?.appearance ?? 'native'} onChange={event => { void set('appearance', event.currentTarget.value); }}><option value="chatgpt">{t('settings.chatgpt')}</option><option value="native">{t('settings.native')}</option></select></label>
    <label className="smartui-setting-row"><span>{t('settings.components')}</span><select disabled={disabled} value={state.value?.enableComponents ? 'on' : 'off'} onChange={event => { void set('enableComponents', event.currentTarget.value === 'on'); }}><option value="on">{t('settings.on')}</option><option value="off">{t('settings.off')}</option></select></label>
    {(pending || notice || state.status !== 'ready' || !state.writable) && <p role="status" className={notice ? 'smartui-error' : 'smartui-caption'}>{t(pending ? 'settings.saving' : notice ?? (state.status === 'loading' ? 'loading' : 'settings.unavailable'))}</p>}
  </section>;
}
