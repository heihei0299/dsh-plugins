import * as React from 'react';
import type { SmartUIDocument } from '../shared/types.js';
import type { ChatNodeProps } from './contracts.js';
import { ComponentBoundary, DocumentView } from './DocumentView.js';
import { useEnvironment, useSettings } from './environment.js';

function documentOf(data: unknown): { callId: string; document: SmartUIDocument } | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  const callId = record.callId;
  const document = record.document;
  if (typeof callId !== 'string' || callId === '') return null;
  if (typeof document !== 'object' || document === null || Array.isArray(document)) return null;
  const blocks = (document as Record<string, unknown>).blocks;
  if (!Array.isArray(blocks) || blocks.length === 0) return null;
  return { callId, document: document as SmartUIDocument };
}

/**
 * Chat row for one recorded document. The definition publishes it at Turn level
 * so it stays visible while the Turn's work details are folded; this component
 * only decides interactivity and degrades to nothing when components are off.
 * @param props - keyed Chat node payload plus the Session input faces.
 * @returns the document card, or null when this profile disables components.
 */
export function DocumentNode(props: ChatNodeProps) {
  const { t, form } = useEnvironment();
  const settings = useSettings(form);
  const phase = props.useInput(snapshot => snapshot.phase);
  const hasClaim = props.useInput(snapshot => Boolean(snapshot.claim));
  const entry = documentOf(props.node.data);
  if (settings.status !== 'ready' || settings.value?.enableComponents !== true || entry === null) return null;
  const editable = phase === 'plain' && !hasClaim;
  return <div className="smartui-node" data-smartui-call={entry.callId}>
    <ComponentBoundary key={entry.callId} fallback={<div className="smartui-fallback"><p>{t('crashed')}</p><pre>{entry.document.summary}</pre></div>}>
      <DocumentView document={entry.document} callId={entry.callId} editable={editable} inputActions={props.inputActions} />
    </ComponentBoundary>
  </div>;
}
