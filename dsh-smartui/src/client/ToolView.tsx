import * as React from 'react';
import type { SmartUIDocument } from '../shared/types.js';
import { BlockView } from './components.js';
import type { ToolViewProps } from './contracts.js';
import { useEnvironment, useSettings } from './environment.js';
import { insertReviewedText, type InsertResult } from './draft.js';
import { toolModel } from './tool-model.js';

export class ComponentBoundary extends React.Component<{ fallback: React.ReactNode; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
function DocumentView({ document, props, editable }: { document: SmartUIDocument; props: ToolViewProps; editable: boolean }) {
  const { t } = useEnvironment();
  const titleId = React.useId();
  const summaryId = React.useId();
  const [notice, setNotice] = React.useState<InsertResult | null>(null);
  const fill = (text: string) => setNotice(insertReviewedText(props.inputActions, text, editable));
  return <article className="smartui-document" aria-labelledby={document.title ? titleId : undefined} aria-describedby={document.summary ? summaryId : undefined} aria-label={document.title ? undefined : t('document')}>
    <header className="smartui-document-header"><div className="smartui-eyebrow"><span aria-hidden="true">✦</span>{t('brand')} · {t('document')}</div>
      {document.title && <h2 id={titleId}>{document.title}</h2>}<p className="smartui-summary" id={document.summary ? summaryId : undefined}>{document.summary}</p>
    </header>
    <div className="smartui-document-body">{document.blocks.map(block => <BlockView key={block.id} block={block} callId={props.callId} disabled={!editable} onFill={fill} />)}</div>
    {notice && <p className={`smartui-notice ${notice === 'inserted' ? '' : 'smartui-error'}`} role="status" aria-live="polite">{t(`insert.${notice}`)}</p>}
    <footer className="smartui-document-footer"><span>{t('localState')}</span>
      {props.inspect && <button type="button" className="smartui-button smartui-button-small" onClick={props.inspect}>{t('inspect')}</button>}
      <details className="smartui-details"><summary>{t('viewSpec')}</summary><pre tabIndex={0}>{JSON.stringify(document, null, 2)}</pre></details>
    </footer>
  </article>;
}
export function ToolView(props: ToolViewProps) {
  const { t, form } = useEnvironment(); const settings = useSettings(form);
  const inputPhase = props.useInput(snapshot => snapshot.phase);
  const hasClaim = props.useInput(snapshot => Boolean(snapshot.claim));
  const model = React.useMemo(() => toolModel(props), [props.phase, props.block]);
  const active = settings.status === 'ready' && settings.value?.enableComponents === true;
  const editable = active && inputPhase === 'plain' && !hasClaim;
  if (model.state === 'preparing' || model.state === 'running') return <div className="smartui-pending" role="status"><span className="smartui-pending-label"><span className="smartui-pending-dot" aria-hidden="true" />{t(model.state)}</span></div>;
  if (!active || model.state !== 'document') return <div className="smartui-fallback">
    <p>{t(!active ? settings.status === 'loading' ? 'loading' : 'disabled' : model.state === 'failed' ? 'failed' : 'fallback')}</p>
    {model.text && <pre tabIndex={0}>{model.text}</pre>}
    {model.state === 'fallback' && model.diagnostic && <details><summary>{t('inspect')}</summary><pre tabIndex={0}>{model.diagnostic}</pre></details>}
    {props.inspect && <button type="button" className="smartui-button smartui-button-small" onClick={props.inspect}>{t('inspect')}</button>}
  </div>;
  return <ComponentBoundary key={props.callId} fallback={<div className="smartui-fallback"><p>{t('crashed')}</p><pre>{model.document.summary}</pre></div>}>
    <DocumentView document={model.document} props={props} editable={editable} />
  </ComponentBoundary>;
}
