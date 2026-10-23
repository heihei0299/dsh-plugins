import * as React from 'react';
import type { ChoicesBlock } from '../shared/types.js';
import { formatActionReply } from '../shared/actions.js';
import { useEnvironment } from './environment.js';

export function Choices({ block, callId, disabled, onFill }: { block: ChoicesBlock; callId: string; disabled: boolean; onFill: (text: string) => void }) {
  const { t } = useEnvironment(); const name = React.useId();
  const [selected, setSelected] = React.useState<string[]>([]); const [error, setError] = React.useState(false);
  const select = (value: string, checked: boolean) => setSelected(previous => block.multiple ? checked ? [...previous.filter(item => item !== value), value] : previous.filter(item => item !== value) : [value]);
  return <div>
    <fieldset className="smartui-fieldset smartui-options" disabled={disabled}>
      <legend className="smartui-sr-only">{block.title ?? t('type.choices')}</legend>
      {block.options.map(option => <label key={option.value} className="smartui-option"><input type={block.multiple ? 'checkbox' : 'radio'} name={name} value={option.value} checked={selected.includes(option.value)} onChange={event => select(option.value, event.currentTarget.checked)} /><span>{option.label}</span></label>)}
      <button className="smartui-button smartui-button-primary" type="button" disabled={!selected.length} onClick={() => {
        setError(false);
        try { onFill(formatActionReply(callId, block, { selected }, t)); } catch { setError(true); }
      }}>{t('fillConversation')}</button>
    </fieldset>
    <p className="smartui-caption">{t('reviewFirst')}</p>
    {error && <p role="alert" className="smartui-error">{t('actionInvalid')}</p>}
  </div>;
}
