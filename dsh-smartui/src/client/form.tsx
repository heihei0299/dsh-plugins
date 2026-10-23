import * as React from 'react';
import type { FormBlock, FormValues } from '../shared/types.js';
import { formatActionReply, validateForm, type FieldError } from '../shared/actions.js';
import { useEnvironment } from './environment.js';

export function Form({ block, callId, disabled, onFill }: { block: FormBlock; callId: string; disabled: boolean; onFill: (text: string) => void }) {
  const { t } = useEnvironment(); const prefix = React.useId();
  const [values, setValues] = React.useState<FormValues>({});
  const [errors, setErrors] = React.useState<Record<string, FieldError>>({});
  const [actionError, setActionError] = React.useState(false);
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (disabled) return;
    const nextErrors = validateForm(block, values); setErrors(nextErrors); setActionError(false);
    const firstInvalid = block.fields.find(field => nextErrors[field.id]);
    if (firstInvalid) {
      const control = event.currentTarget.elements.namedItem(firstInvalid.id);
      if (control instanceof HTMLElement) control.focus();
      return;
    }
    try { onFill(formatActionReply(callId, block, values, t)); } catch { setActionError(true); }
  }
  return <form className="smartui-form" noValidate onSubmit={submit}>
    <fieldset disabled={disabled} className="smartui-fieldset"><legend className="smartui-sr-only">{block.title ?? t('type.form')}</legend>
      {block.fields.map(field => {
        const id = `${prefix}-${field.id}`; const errorId = `${id}-error`; const error = errors[field.id];
        const change = (value: string | number | boolean | null) => {
          setValues(previous => ({ ...previous, [field.id]: value }));
          setErrors(previous => {
            if (!previous[field.id]) return previous;
            const next = { ...previous }; delete next[field.id]; return next;
          });
          setActionError(false);
        };
        const common = { id, name: field.id, 'aria-required': field.required || undefined, 'aria-invalid': Boolean(error), 'aria-describedby': error ? errorId : undefined };
        return <div key={field.id} className={`smartui-field ${field.type === 'checkbox' ? 'smartui-checkbox-field' : ''}`}>
          <label htmlFor={id}>{field.label}{field.required && <span className="smartui-required"> {t('required')}</span>}</label>
          {field.type === 'checkbox'
            ? <input {...common} type="checkbox" checked={values[field.id] === true} onChange={event => change(event.currentTarget.checked)} />
            : field.type === 'textarea'
              ? <textarea {...common} rows={3} maxLength={8_000} value={String(values[field.id] ?? '')} placeholder={field.placeholder} onChange={event => change(event.currentTarget.value)} />
              : field.type === 'select'
                ? <select {...common} value={String(values[field.id] ?? '')} onChange={event => change(event.currentTarget.value)}><option value="">{t('choose')}</option>{field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
                : <input {...common} type={field.type} step={field.type === 'number' ? 'any' : undefined} min={field.min} max={field.max} maxLength={field.type === 'text' ? 8_000 : undefined} value={values[field.id] === null ? '' : String(values[field.id] ?? '')} placeholder={field.placeholder} onChange={event => change(field.type === 'number' ? event.currentTarget.value === '' ? null : Number(event.currentTarget.value) : event.currentTarget.value)} />}
          {error && <p id={errorId} className="smartui-error">{t(`validation.${error}`)}</p>}
        </div>;
      })}
      <button type="submit" className="smartui-button smartui-button-primary">{t('fillConversation')}</button>
    </fieldset>
    <p className="smartui-caption">{t('reviewFirst')}</p>
    {actionError && <p role="alert" className="smartui-error">{t('actionInvalid')}</p>}
  </form>;
}
