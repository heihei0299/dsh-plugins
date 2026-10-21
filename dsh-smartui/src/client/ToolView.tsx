import * as React from 'react';
import type { ToolViewProps } from './contracts.js';
import { useEnvironment, useSettings } from './environment.js';
import { toolModel } from './tool-model.js';

/**
 * Tool row body for `render_smart_ui`.
 *
 * The document itself is published by `smartuiDocumentDefinition` as a Turn-level
 * Chat row, which stays visible when the Turn's work details fold. This body never
 * repeats the card: it reports the recorded document in one line and keeps the
 * plain-text fallback for profiles where components are off or the payload is bad.
 * @param props - the tool call stage and recorded result.
 * @returns a compact status line, or the degraded text fallback.
 */
export function ToolView(props: ToolViewProps) {
  const { t, form } = useEnvironment(); const settings = useSettings(form);
  const model = React.useMemo(() => toolModel(props), [props.phase, props.block]);
  const active = settings.status === 'ready' && settings.value?.enableComponents === true;
  if (model.state === 'preparing' || model.state === 'running') return <div className="smartui-pending" role="status"><span className="smartui-pending-label"><span className="smartui-pending-dot" aria-hidden="true" />{t(model.state)}</span></div>;
  if (!active || model.state !== 'document') return <div className="smartui-fallback">
    <p>{t(!active ? settings.status === 'loading' ? 'loading' : 'disabled' : model.state === 'failed' ? 'failed' : 'fallback')}</p>
    {model.text && <pre tabIndex={0}>{model.text}</pre>}
    {model.state === 'fallback' && model.diagnostic && <details><summary>{t('inspect')}</summary><pre tabIndex={0}>{model.diagnostic}</pre></details>}
    {props.inspect && <button type="button" className="smartui-button smartui-button-small" onClick={props.inspect}>{t('inspect')}</button>}
  </div>;
  return <div className="smartui-compact" role="status">
    <span className="smartui-compact-mark" aria-hidden="true">✦</span>
    <span className="smartui-compact-title">{model.document.title ?? t('document')}</span>
    <span className="smartui-compact-meta">{t('documentShown', { blocks: model.document.blocks.length })}</span>
    {props.inspect && <button type="button" className="smartui-button smartui-button-small" onClick={props.inspect}>{t('inspect')}</button>}
  </div>;
}
