import * as React from 'react';
import type { CardBlock, TableBlock, ChartBlock, FormBlock, ChoicesBlock, FormValues, SmartUIBlock } from '../shared/types.js';
import { cellText, compareCells, formatActionReply, tableText, validateForm, type FieldError } from '../shared/actions.js';
import { useEnvironment } from './environment.js';

function CopyButton({ text }: { text: string }) {
  const { t } = useEnvironment();
  const [status, setStatus] = React.useState<'idle' | 'done' | 'manual'>('idle');
  const mounted = React.useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      if (mounted.current) setStatus('done');
    } catch { if (mounted.current) setStatus('manual'); }
  }
  return <div className="smartui-copy">
    <button type="button" className="smartui-button smartui-button-small" onClick={() => { void copy(); }}>{t(status === 'done' ? 'copied' : 'copy')}</button>
    {status === 'manual' && <label className="smartui-manual-copy">{t('copyManual')}<textarea readOnly value={text} onFocus={event => event.currentTarget.select()} /></label>}
  </div>;
}
export function Card({ block }: { block: CardBlock }) {
  return <div className="smartui-card-content">
    {block.value !== undefined && <div className="smartui-metric">{block.value}</div>}
    <p className="smartui-prose">{block.body}</p>
    {block.caption && <p className="smartui-caption">{block.caption}</p>}
    <CopyButton text={[block.title, block.value, block.body, block.caption].filter(value => value !== undefined).join('\n')} />
  </div>;
}
export function DataTable({ block }: { block: TableBlock }) {
  const { t } = useEnvironment();
  const [sort, setSort] = React.useState<{ column: number; direction: 1 | -1 } | null>(null);
  const rows = React.useMemo(() => sort ? [...block.rows].sort((a, b) => sort.direction * compareCells(a[sort.column] ?? null, b[sort.column] ?? null)) : block.rows, [block.rows, sort]);
  const toggle = (column: number) => setSort(previous => previous?.column === column ? previous.direction === 1 ? { column, direction: -1 } : null : { column, direction: 1 });
  return <>
    <div className="smartui-table-scroll" role="region" aria-label={block.title ?? t('type.table')} tabIndex={0}>
      <table className="smartui-table">
        <caption className="smartui-sr-only">{block.title ?? t('type.table')}</caption>
        <thead><tr>{block.columns.map((column, i) => <th key={column.id} scope="col" aria-sort={sort?.column === i ? sort.direction === 1 ? 'ascending' : 'descending' : 'none'}>
          <button type="button" onClick={() => toggle(i)} aria-label={t('sort', { label: column.label })}>{column.label}<span aria-hidden="true">{sort?.column === i ? sort.direction === 1 ? ' ↑' : ' ↓' : ' ↕'}</span></button>
        </th>)}</tr></thead>
        <tbody>{rows.length ? rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cellText(cell)}</td>)}</tr>) : <tr><td colSpan={block.columns.length}>{t('emptyTable')}</td></tr>}</tbody>
      </table>
    </div>
    <CopyButton text={tableText(block.columns.map(column => column.label), rows)} />
  </>;
}
export function Chart({ block }: { block: ChartBlock }) {
  const { t } = useEnvironment(); const titleId = React.useId();
  const first = block.series[0];
  if (!first) return null; // Validator forbids this; no undefined SVG coordinates on unexpected input.
  const all = block.series.flatMap(series => series.points.map(point => point.value));
  const min = Math.min(0, ...all); const max = Math.max(0, ...all); const range = max - min || 1;
  const width = 640; const left = 58; const right = 16; const top = 18; const height = 180;
  const plotWidth = width - left - right; const step = plotWidth / first.points.length;
  const y = (value: number) => top + height - (value - min) / range * height;
  const baseline = y(0); const ticks = [min, min + range / 2, min + range];
  const shortNumber = (value: number) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  return <>
    <div className="smartui-chart">
      <svg viewBox={`0 0 ${width} 242`} role="img" aria-labelledby={titleId}>
        <title id={titleId}>{`${block.title ?? t('type.chart')}. ${t('chartAlternative')}`}</title>
        {ticks.map((tick, i) => <g key={i} className="smartui-grid">
          <line x1={left} y1={y(tick)} x2={width - right} y2={y(tick)} />
          <text x={left - 8} y={y(tick) + 4} textAnchor="end">{shortNumber(tick)}</text>
        </g>)}
        <line className="smartui-baseline" x1={left} y1={baseline} x2={width - right} y2={baseline} />
        {block.series.map((series, seriesIndex) => <g key={series.id} className={`smartui-series-${seriesIndex}`}>
          {block.chartType === 'line' && <polyline className="smartui-line" points={series.points.map((point, i) => `${left + step * (i + 0.5)},${y(point.value)}`).join(' ')} />}
          {series.points.map((point, i) => {
            const description = `${series.label} · ${point.label}: ${point.value}`;
            return block.chartType === 'bar'
              ? <rect key={point.label} x={left + step * i + step * 0.1 + step * 0.8 * seriesIndex / block.series.length} y={Math.min(y(point.value), baseline)} width={Math.max(0.25, step * 0.8 / block.series.length - 1)} height={Math.max(0.5, Math.abs(y(point.value) - baseline))}><title>{description}</title></rect>
              : <circle key={point.label} cx={left + step * (i + 0.5)} cy={y(point.value)} r={first.points.length > 60 ? 1.5 : 3}><title>{description}</title></circle>;
          })}
        </g>)}
        {first.points.map((point, i) => i % Math.ceil(first.points.length / 6) === 0 && <text key={point.label} className="smartui-axis-label" x={left + step * (i + 0.5)} y={222} textAnchor="middle">{point.label.length > 10 ? `${point.label.slice(0, 9)}…` : point.label}</text>)}
      </svg>
      <ul className="smartui-legend">{block.series.map((series, i) => <li key={series.id} className={`smartui-series-${i}`}><span aria-hidden="true">●</span> {series.label}</li>)}</ul>
    </div>
    <details className="smartui-details"><summary>{t('viewData')}</summary>
      <div className="smartui-table-scroll" role="region" aria-label={t('viewData')} tabIndex={0}><table className="smartui-table">
        <caption className="smartui-sr-only">{block.title ?? t('type.chart')}</caption>
        <thead><tr><th scope="col">{t('category')}</th>{block.series.map(series => <th key={series.id} scope="col">{series.label}</th>)}</tr></thead>
        <tbody>{first.points.map((point, i) => <tr key={point.label}><th scope="row">{point.label}</th>{block.series.map(series => <td key={series.id}>{series.points[i]?.value}</td>)}</tr>)}</tbody>
      </table></div>
    </details>
  </>;
}
export function Form({ block, callId, disabled, onFill }: { block: FormBlock; callId: string; disabled: boolean; onFill: (text: string) => void }) {
  const { t } = useEnvironment(); const prefix = React.useId();
  const [values, setValues] = React.useState<FormValues>({});
  const [errors, setErrors] = React.useState<Record<string, FieldError>>({});
  const [actionError, setActionError] = React.useState(false);
  function submit(event: React.FormEvent) {
    event.preventDefault(); if (disabled) return;
    const nextErrors = validateForm(block, values); setErrors(nextErrors); setActionError(false);
    if (Object.keys(nextErrors).length) return;
    try { onFill(formatActionReply(callId, block, values, t)); } catch { setActionError(true); }
  }
  return <form className="smartui-form" noValidate onSubmit={submit}>
    <fieldset disabled={disabled} className="smartui-fieldset"><legend className="smartui-sr-only">{block.title ?? t('type.form')}</legend>
      {block.fields.map(field => {
        const id = `${prefix}-${field.id}`; const errorId = `${id}-error`; const error = errors[field.id];
        const change = (value: string | number | boolean | null) => setValues(previous => ({ ...previous, [field.id]: value }));
        const common = { id, 'aria-required': field.required || undefined, 'aria-invalid': Boolean(error), 'aria-describedby': error ? errorId : undefined };
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
export function BlockView({ block, callId, disabled, onFill }: { block: SmartUIBlock; callId: string; disabled: boolean; onFill: (text: string) => void }) {
  const { t } = useEnvironment();
  return <section className={`smartui-block smartui-block-${block.type}`}>
    <h3 className="smartui-block-title">{block.title ?? t(`type.${block.type}`)}</h3>
    {block.type === 'card' ? <Card block={block} /> : block.type === 'table' ? <DataTable block={block} /> : block.type === 'chart' ? <Chart block={block} /> : block.type === 'form' ? <Form block={block} callId={callId} disabled={disabled} onFill={onFill} /> : <Choices block={block} callId={callId} disabled={disabled} onFill={onFill} />}
  </section>;
}
