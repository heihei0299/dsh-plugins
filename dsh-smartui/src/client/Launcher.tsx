import * as React from 'react';
import type { SessionProps } from './contracts.js';
import { useEnvironment, useSettings } from './environment.js';
import { insertReviewedText, type InsertResult } from './draft.js';
export function Launcher(props: SessionProps) {
  const { t, form } = useEnvironment(); const state = useSettings(form);
  const hasDraft = props.useInput(snapshot => Boolean(snapshot.draft.trim()));
  const editable = props.useInput(snapshot => snapshot.phase === 'plain' && !snapshot.claim);
  const [notice, setNotice] = React.useState<InsertResult | null>(null);
  if (state.status !== 'ready' || !state.value?.enableComponents || hasDraft) return null;
  /* Starting suggestions belong to a Session without an accepted turn; a running
   * conversation must not carry a permanent chip row above its composer. */
  if (props.session?.blank === false) return null;
  return <div className="smartui-launcher"><span className="smartui-launcher-title">✦ {t('launcher')}</span>
    {(['dashboard', 'table', 'chart', 'form'] as const).map(kind => <button type="button" key={kind} disabled={!editable} className="smartui-button smartui-button-small" onClick={() => setNotice(insertReviewedText(props.inputActions, t(`prompt.${kind}`), editable))}>{t(`suggest.${kind}`)}</button>)}
    {notice && <p className="smartui-launcher-help" role="status">{t(`insert.${notice}`)}</p>}
  </div>;
}
