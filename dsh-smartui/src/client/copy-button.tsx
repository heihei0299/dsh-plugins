import * as React from 'react';
import { useEnvironment } from './environment.js';

export function CopyButton({ text }: { text: string }) {
  const { t } = useEnvironment();
  const [status, setStatus] = React.useState<'idle' | 'done' | 'manual'>('idle');
  const mounted = React.useRef(true);
  const currentText = React.useRef(text); currentText.current = text;
  React.useEffect(() => { setStatus('idle'); }, [text]);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      if (mounted.current && currentText.current === text) setStatus('done');
    } catch { if (mounted.current && currentText.current === text) setStatus('manual'); }
  }
  return <div className="smartui-copy">
    <button type="button" className="smartui-button smartui-button-small" onClick={() => { void copy(); }}>{t(status === 'done' ? 'copied' : 'copy')}</button>
    <span className="smartui-sr-only" role="status">{status === 'done' ? t('copied') : status === 'manual' ? t('copyManual') : ''}</span>
    {status === 'manual' && <label className="smartui-manual-copy">{t('copyManual')}<textarea readOnly value={text} onFocus={event => event.currentTarget.select()} /></label>}
  </div>;
}
