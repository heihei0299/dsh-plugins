import * as React from 'react';
import type { CardBlock, TableBlock, ChartBlock, FormBlock, ChoicesBlock, FormValues, SmartUIBlock } from '../shared/types.js';
import { cellText, compareCells, formatActionReply, tableText, validateForm, type FieldError } from '../shared/actions.js';
import { useEnvironment } from './environment.js';

const compactNumber = new Intl.NumberFormat(undefined, { notation: 'compact', maximumSignificantDigits: 3 });
const scientificNumbers = new Map<number, Intl.NumberFormat>();
function scientificNumber(digits: number): Intl.NumberFormat {
  let formatter = scientificNumbers.get(digits);
  if (!formatter) {
    formatter = new Intl.NumberFormat(undefined, { notation: 'scientific', maximumSignificantDigits: digits });
    scientificNumbers.set(digits, formatter);
  }
  return formatter;
}
/** Compact labels stay short for ordinary magnitudes; scientific notation keeps tiny or huge ticks distinct. */
function formatValue(value: number): string {
  if (value === 0) return '0';
  const magnitude = Math.abs(value);
  return magnitude < 1e-4 || magnitude >= 1e12 ? scientificNumber(3).format(value) : compactNumber.format(value);
}
function formatAxisTicks(ticks: readonly number[], step: number): string[] {
  const scientific = ticks.some(value => value !== 0 && (Math.abs(value) < 1e-4 || Math.abs(value) >= 1e12));
  const labels = ticks.map(value => value === 0 ? '0' : scientific ? scientificNumber(3).format(value) : compactNumber.format(value));
  if (new Set(labels).size === labels.length) return labels;
  // Compact notation can merge neighbouring ticks (for example 1.00012 and 1). Give every tick
  // enough significant digits to remain distinct, even for fractional or enormous magnitudes.
  return ticks.map(value => {
    if (value === 0) return '0';
    const ratio = Number.isFinite(step) && step > 0 ? Math.abs(value) / step : 1;
    const digits = Number.isFinite(ratio) && ratio > 0 ? Math.min(9, Math.max(3, Math.ceil(Math.log10(ratio)) + 1)) : 3;
    return scientificNumber(digits).format(value);
  });
}
/** 1-2-5 ticks that always include zero, so bars and negative values share one honest baseline. */
function chartTicks(low: number, high: number): { min: number; max: number; ticks: number[]; step: number } {
  if (!(high > low)) return { min: low, max: low + 1, ticks: [low, low + 0.5, low + 1], step: 0.5 };
  const span = high - low;
  const rough = span / 5;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const residual = rough / magnitude;
  const step = magnitude * (residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10);
  // Subnormal spans (for example Number.MIN_VALUE) can round the midpoint to zero or a duplicate.
  const fallbackTicks = [low];
  const middle = low + span / 2;
  if (middle > low && middle < high) fallbackTicks.push(middle);
  fallbackTicks.push(high);
  const fallback = { min: low, max: high, ticks: fallbackTicks, step: span / 2 };
  if (!Number.isFinite(step) || step <= 0) return fallback;
  const min = Math.floor(low / step) * step;
  const max = Math.ceil(high / step) * step;
  const count = Math.round((max - min) / step);
  if (!Number.isFinite(count) || count < 1) return fallback;
  const ticks: number[] = [];
  for (let index = 0; index <= Math.min(count, 10); index += 1) {
    const tick = Number.parseFloat((min + index * step).toPrecision(12));
    if (tick > (ticks[ticks.length - 1] ?? Number.NEGATIVE_INFINITY)) ticks.push(tick);
  }
  return { min, max, ticks, step };
}
function truncateLabel(label: string): string {
  const characters = Array.from(label);
  return characters.length > 8 ? `${characters.slice(0, 7).join('')}…` : label;
}

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
    <span className="smartui-sr-only" role="status">{status === 'done' ? t('copied') : status === 'manual' ? t('copyManual') : ''}</span>
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
  const numericColumns = React.useMemo(() => block.columns.map((_, column) =>
    block.rows.some(row => typeof row[column] === 'number')
    && block.rows.every(row => { const cell = row[column]; return cell === null || typeof cell === 'number'; })), [block.columns, block.rows]);
  const toggle = (column: number) => setSort(previous => previous?.column === column ? previous.direction === 1 ? { column, direction: -1 } : null : { column, direction: 1 });
  return <>
    <div className="smartui-table-scroll" role="region" aria-label={block.title ?? t('type.table')} tabIndex={0}>
      <table className="smartui-table">
        <caption className="smartui-sr-only">{block.title ?? t('type.table')}</caption>
        <thead><tr>{block.columns.map((column, i) => {
          const direction = sort?.column === i ? sort.direction : 0;
          return <th key={column.id} scope="col" className={numericColumns[i] ? 'smartui-num' : undefined} aria-sort={direction === 1 ? 'ascending' : direction === -1 ? 'descending' : 'none'}>
            <button type="button" onClick={() => toggle(i)} aria-label={direction === 1 ? t('sortDescending', { label: column.label }) : direction === -1 ? t('sortClear', { label: column.label }) : t('sort', { label: column.label })}>{column.label}<span aria-hidden="true">{direction === 1 ? ' ↑' : direction === -1 ? ' ↓' : ' ↕'}</span></button>
          </th>;
        })}</tr></thead>
        <tbody>{rows.length ? rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j} className={numericColumns[j] ? 'smartui-num' : undefined}>{cellText(cell)}</td>)}</tr>) : <tr><td colSpan={block.columns.length} className="smartui-table-empty">{t('emptyTable')}</td></tr>}</tbody>
      </table>
    </div>
    <CopyButton text={tableText(block.columns.map(column => column.label), rows)} />
  </>;
}
export function Chart({ block }: { block: ChartBlock }) {
  const { t } = useEnvironment(); const titleId = React.useId();
  const first = block.series[0];
  if (!first) return null; // Validator forbids this; no undefined SVG coordinates on unexpected input.
  const values = block.series.flatMap(series => series.points.map(point => point.value));
  const scale = chartTicks(Math.min(0, ...values), Math.max(0, ...values));
  const axisLabels = formatAxisTicks(scale.ticks, scale.step);
  const width = 640; const left = 58; const right = 16; const top = 18; const height = 180;
  const plotWidth = width - left - right;
  const count = first.points.length;
  const step = count > 0 ? plotWidth / count : plotWidth;
  const range = scale.max - scale.min || 1;
  const y = (value: number) => top + height - (value - scale.min) / range * height;
  const baseline = y(0);
  const seriesCount = block.series.length;
  const slot = Math.max(0.25, step * 0.8 / seriesCount);
  const gap = slot >= 3 ? 1 : 0;
  const barWidth = Math.max(0.25, Math.min(48, slot - gap));
  const groupWidth = barWidth * seriesCount + gap * (seriesCount - 1);
  const centerX = (index: number) => left + step * (index + 0.5);
  const barX = (index: number, seriesIndex: number) => left + step * index + (step - groupWidth) / 2 + seriesIndex * (barWidth + gap);
  const showValues = seriesCount * count <= 8;
  const dash = ['', '7 4', '2 3', '9 3 2 3'];
  const labelStride = Math.max(1, Math.ceil(count / Math.max(2, Math.min(6, Math.floor(plotWidth / 84)))));
  const labelIndices: number[] = [];
  for (let index = 0; index < count; index += labelStride) labelIndices.push(index);
  if (count > 0 && labelIndices[labelIndices.length - 1] !== count - 1) labelIndices[labelIndices.length - 1] = count - 1;
  const title = [block.title ?? t('type.chart'), block.series.map(series => series.label).join(', '), t('chartAlternative')].filter(Boolean).join('. ');
  return <>
    <div className="smartui-chart">
      <div className="smartui-chart-scroll" role="region" aria-label={block.title ?? t('type.chart')} tabIndex={0}>
        <svg viewBox={`0 0 ${width} 242`} role="img" aria-labelledby={titleId}>
          <title id={titleId}>{title}</title>
          {scale.ticks.map((tick, i) => <g key={tick} className="smartui-grid">
            <line x1={left} y1={y(tick)} x2={width - right} y2={y(tick)} />
            <text x={left - 8} y={y(tick) + 4} textAnchor="end">{axisLabels[i] ?? formatValue(tick)}</text>
          </g>)}
          <line className="smartui-baseline" x1={left} y1={baseline} x2={width - right} y2={baseline} />
          {block.series.map((series, seriesIndex) => <g key={series.id} className={`smartui-series-${seriesIndex}`}>
            {block.chartType === 'line' && <polyline className="smartui-line" points={series.points.map((point, i) => `${centerX(i)},${y(point.value)}`).join(' ')} strokeDasharray={seriesCount > 1 && seriesIndex > 0 ? dash[seriesIndex] : undefined} />}
            {series.points.map((point, i) => {
              const description = `${series.label} · ${point.label}: ${point.value}`;
              const pointX = centerX(i); const pointY = y(point.value);
              return block.chartType === 'bar'
                ? <rect key={point.label} x={barX(i, seriesIndex)} y={Math.min(pointY, baseline)} width={barWidth} height={Math.max(0.5, Math.abs(pointY - baseline))}><title>{description}</title></rect>
                : <circle key={point.label} cx={pointX} cy={pointY} r={count > 60 ? 1.5 : count === 1 ? 4 : 3}><title>{description}</title></circle>;
            })}
            {showValues && series.points.map((point, i) => {
              const pointY = y(point.value);
              const valueY = point.value < 0
                ? block.chartType === 'bar' ? pointY + 12 : pointY + 14
                : block.chartType === 'bar' ? pointY - 4 : pointY - 7;
              return <text key={`value-${point.label}`} className="smartui-value-label" x={block.chartType === 'bar' ? barX(i, seriesIndex) + barWidth / 2 : centerX(i)} y={valueY} textAnchor="middle" fontSize={10} fontWeight={600} fill="currentColor">{formatValue(point.value)}</text>;
            })}
          </g>)}
          {labelIndices.map(index => {
            const point = first.points[index]; if (!point) return null;
            const x = centerX(index);
            const anchor = x < left + 48 ? 'start' : x > width - right - 48 ? 'end' : 'middle';
            return <text key={point.label} className="smartui-axis-label" x={x} y={222} textAnchor={anchor}>{truncateLabel(point.label)}<title>{point.label}</title></text>;
          })}
        </svg>
      </div>
      <p className="smartui-caption smartui-chart-hint">{t('chartScroll')}</p>
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
  const { t } = useEnvironment(); const titleId = React.useId();
  return <section className={`smartui-block smartui-block-${block.type}`} aria-labelledby={titleId}>
    <h3 className="smartui-block-title" id={titleId}>{block.title ?? t(`type.${block.type}`)}</h3>
    {block.type === 'card' ? <Card block={block} /> : block.type === 'table' ? <DataTable block={block} /> : block.type === 'chart' ? <Chart block={block} /> : block.type === 'form' ? <Form block={block} callId={callId} disabled={disabled} onFill={onFill} /> : <Choices block={block} callId={callId} disabled={disabled} onFill={onFill} />}
  </section>;
}
