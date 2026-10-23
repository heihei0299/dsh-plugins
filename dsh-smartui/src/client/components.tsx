import * as React from 'react';
import type { CardBlock, ChartBlock, StatBlock, ProgressBlock, CalloutBlock, SmartUILeafBlock } from '../shared/types.js';
import { chartTicks, formatAxisTicks, formatValue, truncateLabel } from './chart.js';
import { useEnvironment } from './environment.js';
import { CopyButton } from './copy-button.js';
import { DataTable } from './table-view.js';
import { Form } from './form.js';
import { Choices } from './choices.js';

export function Card({ block }: { block: CardBlock }) {
  return <div className="smartui-card-content">
    {block.value !== undefined && <div className="smartui-metric">{block.value}</div>}
    <p className="smartui-prose">{block.body}</p>
    {block.caption && <p className="smartui-caption">{block.caption}</p>}
    <CopyButton text={[block.title, block.value, block.body, block.caption].filter(value => value !== undefined).join('\n')} />
  </div>;
}
export function Stat({ block }: { block: StatBlock }) {
  const { t } = useEnvironment();
  const points = block.spark;
  const min = points ? Math.min(...points) : 0;
  const max = points ? Math.max(...points) : 0;
  return <div className="smartui-stat">
    <div className="smartui-metric">{block.value}</div>
    {block.delta && <p className={`smartui-delta smartui-tone-${block.tone ?? 'neutral'}`}>{block.delta}</p>}
    {points && <svg className="smartui-spark" viewBox="0 0 240 48" role="img" aria-label={t('statTrend', { values: points.join(', ') })}>
      <polyline fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
        points={points.map((value, index) => `${2 + index / (points.length - 1) * 236},${max === min ? 24 : 44 - (value - min) / (max - min) * 40}`).join(' ')} />
    </svg>}
    {block.caption && <p className="smartui-caption">{block.caption}</p>}
  </div>;
}
export function Progress({ block }: { block: ProgressBlock }) {
  const { t } = useEnvironment();
  const label = `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(block.value)}%`;
  return <div className={`smartui-progress smartui-progress-${block.variant ?? 'bar'}`}>
    <div className="smartui-progress-meter" role="progressbar" aria-label={block.title ?? t('type.progress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={block.value}>
      {block.variant === 'ring' ? <svg viewBox="0 0 64 64" aria-hidden="true">
        <circle className="smartui-progress-track" cx={32} cy={32} r={26} />
        <circle className="smartui-progress-fill" cx={32} cy={32} r={26} pathLength={100} strokeDasharray={`${block.value} 100`} transform="rotate(-90 32 32)" />
      </svg> : <span className="smartui-progress-track"><span className="smartui-progress-fill" style={{ width: `${block.value}%` }} /></span>}
      <span className="smartui-progress-value">{label}</span>
    </div>
    {block.caption && <p className="smartui-caption">{block.caption}</p>}
  </div>;
}
export function Callout({ block }: { block: CalloutBlock }) {
  const { t } = useEnvironment();
  const symbol = { neutral: 'i', success: '✓', warning: '!', error: '×' }[block.tone ?? 'neutral'];
  return <div className={`smartui-callout smartui-tone-${block.tone ?? 'neutral'}`}>
    <span className="smartui-callout-icon" aria-hidden="true">{symbol}</span><div><span className="smartui-sr-only">{t(`tone.${block.tone ?? 'neutral'}`)}: </span><p className="smartui-prose">{block.body}</p></div>
  </div>;
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
export function BlockView({ block, callId, disabled, onFill }: { block: SmartUILeafBlock; callId: string; disabled: boolean; onFill: (text: string) => void }) {
  const { t } = useEnvironment(); const titleId = React.useId();
  let content: React.ReactNode;
  switch (block.type) {
    case 'card': content = <Card block={block} />; break;
    case 'stat': content = <Stat block={block} />; break;
    case 'progress': content = <Progress block={block} />; break;
    case 'callout': content = <Callout block={block} />; break;
    case 'table': content = <DataTable block={block} />; break;
    case 'chart': content = <Chart block={block} />; break;
    case 'form': content = <Form block={block} callId={callId} disabled={disabled} onFill={onFill} />; break;
    case 'choices': content = <Choices block={block} callId={callId} disabled={disabled} onFill={onFill} />; break;
  }
  return <section className={`smartui-block smartui-block-${block.type}`} aria-labelledby={titleId}>
    <h3 className="smartui-block-title" id={titleId}>{block.title ?? t(`type.${block.type}`)}</h3>
    {content}
  </section>;
}
