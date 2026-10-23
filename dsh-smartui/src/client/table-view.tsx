import * as React from 'react';
import type { TableBlock } from '../shared/types.js';
import { cellText } from '../shared/actions.js';
import { exportTable, visibleTableRows, type TableFormat, type TableSort } from '../shared/table.js';
import { useEnvironment } from './environment.js';
import { CopyButton } from './copy-button.js';

export function DataTable({ block }: { block: TableBlock }) {
  const { t } = useEnvironment();
  const [sort, setSort] = React.useState<TableSort | null>(null);
  const [query, setQuery] = React.useState('');
  const [format, setFormat] = React.useState<TableFormat>('tsv');
  const rows = React.useMemo(() => visibleTableRows(block.rows, query, sort), [block.rows, query, sort]);
  const numericColumns = React.useMemo(() => block.columns.map((_, column) =>
    block.rows.some(row => typeof row[column] === 'number')
    && block.rows.every(row => { const cell = row[column]; return cell === null || typeof cell === 'number'; })), [block.columns, block.rows]);
  const toggle = (column: number) => setSort(previous => previous?.column === column ? previous.direction === 1 ? { column, direction: -1 } : null : { column, direction: 1 });
  return <>
    <div className="smartui-table-toolbar">
      <label className="smartui-table-filter">{t('filterTable')}<input type="search" maxLength={160} value={query} placeholder={t('filterPlaceholder')} onChange={event => setQuery(event.currentTarget.value)} /></label>
      <span className="smartui-caption" role="status" aria-live="polite">{t('tableCount', { visible: rows.length, total: block.rows.length })}</span>
    </div>
    <div className="smartui-table-scroll" role="region" aria-label={block.title ?? t('type.table')} tabIndex={0}>
      <table className="smartui-table">
        <caption className="smartui-sr-only">{block.title ?? t('type.table')}</caption>
        <thead><tr>{block.columns.map((column, i) => {
          const direction = sort?.column === i ? sort.direction : 0;
          return <th key={column.id} scope="col" className={numericColumns[i] ? 'smartui-num' : undefined} aria-sort={direction === 1 ? 'ascending' : direction === -1 ? 'descending' : 'none'}>
            <button type="button" onClick={() => toggle(i)} aria-label={direction === 1 ? t('sortDescending', { label: column.label }) : direction === -1 ? t('sortClear', { label: column.label }) : t('sort', { label: column.label })}>{column.label}<span aria-hidden="true">{direction === 1 ? ' ↑' : direction === -1 ? ' ↓' : ' ↕'}</span></button>
          </th>;
        })}</tr></thead>
        <tbody>{rows.length ? rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j} className={numericColumns[j] ? 'smartui-num' : undefined}>{cellText(cell)}</td>)}</tr>) : <tr><td colSpan={block.columns.length} className="smartui-table-empty">{t(query.trim() ? 'noMatchingRows' : 'emptyTable')}</td></tr>}</tbody>
      </table>
    </div>
    <div className="smartui-table-export">
      <label>{t('exportFormat')}<select value={format} onChange={event => setFormat(event.currentTarget.value as TableFormat)}>
        <option value="tsv">TSV</option><option value="csv">CSV</option><option value="markdown">Markdown</option>
      </select></label>
      <CopyButton text={exportTable(block.columns.map(column => column.label), rows, format)} />
    </div>
    <p className="smartui-caption">{t('exportVisible')}</p>
  </>;
}
