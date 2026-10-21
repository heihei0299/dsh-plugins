import * as React from 'react';
import type { SmartUIDocument } from '../shared/types.js';
import { BlockView } from './components.js';
import type { InputActions } from './contracts.js';
import { insertReviewedText, type InsertResult } from './draft.js';
import { useEnvironment } from './environment.js';

export class ComponentBoundary extends React.Component<{ fallback: React.ReactNode; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export interface DocumentViewProps {
  document: SmartUIDocument;
  /** Stable call identity that scopes every action in this document. */
  callId: string;
  editable: boolean;
  inputActions: InputActions | undefined;
  inspect?: (() => void) | undefined;
}

/**
 * Recorded document shell shared by the Chat row and any future host.
 * Rendering never mutates input; only an explicit component action may fill the draft.
 */
export function DocumentView({ document, callId, editable, inputActions, inspect }: DocumentViewProps) {
  const { t } = useEnvironment();
  const titleId = React.useId();
  const summaryId = React.useId();
  const [notice, setNotice] = React.useState<InsertResult | null>(null);
  const fill = (text: string) => setNotice(insertReviewedText(inputActions, text, editable));
  return <article className="smartui-document" aria-labelledby={document.title ? titleId : undefined} aria-describedby={document.summary ? summaryId : undefined} aria-label={document.title ? undefined : t('document')}>
    <header className="smartui-document-header"><div className="smartui-eyebrow"><span aria-hidden="true">✦</span>{t('brand')} · {t('document')}</div>
      {document.title && <h2 id={titleId}>{document.title}</h2>}<p className="smartui-summary" id={document.summary ? summaryId : undefined}>{document.summary}</p>
    </header>
    <div className="smartui-document-body">{document.blocks.map(block => <BlockView key={block.id} block={block} callId={callId} disabled={!editable} onFill={fill} />)}</div>
    {notice && <p className={`smartui-notice ${notice === 'inserted' ? '' : 'smartui-error'}`} role="status" aria-live="polite">{t(`insert.${notice}`)}</p>}
    <footer className="smartui-document-footer"><span>{t('localState')}</span>
      {inspect && <button type="button" className="smartui-button smartui-button-small" onClick={inspect}>{t('inspect')}</button>}
      <details className="smartui-details"><summary>{t('viewSpec')}</summary><pre tabIndex={0}>{JSON.stringify(document, null, 2)}</pre></details>
    </footer>
  </article>;
}
