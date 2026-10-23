import { cellText, compareCells, tableText } from './actions.js';
import type { Cell } from './types.js';

export type TableFormat = 'tsv' | 'csv' | 'markdown';
export interface TableSort { column: number; direction: 1 | -1 }

/** Filtering and sorting are local views: the recorded rows are never mutated. */
export function visibleTableRows(rows: readonly Cell[][], query: string, sort: TableSort | null): Cell[][] {
  const needle = query.trim().toLocaleLowerCase();
  const filtered = needle ? rows.filter(row => row.some(cell => cellText(cell).toLocaleLowerCase().includes(needle))) : [...rows];
  return sort ? filtered.sort((a, b) => sort.direction * compareCells(a[sort.column] ?? null, b[sort.column] ?? null)) : filtered;
}

/** Copy only the visible rows in their current order, not hidden source data. */
export function exportTable(columns: readonly string[], rows: readonly Cell[][], format: TableFormat): string {
  if (format === 'tsv') return tableText(columns, rows);
  if (format === 'csv') {
    const cell = (value: Cell) => {
      const raw = cellText(value);
      // Text (including headings) must not become a spreadsheet formula. Typed numbers stay numbers.
      const safe = typeof value === 'string' && /^\s*[=+\-@]/.test(raw) ? `'${raw}` : raw;
      return `"${safe.replaceAll('"', '""')}"`;
    };
    return [columns, ...rows].map(row => row.map(cell).join(',')).join('\r\n');
  }
  const cell = (value: Cell) => cellText(value).replaceAll('\\', '\\\\').replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('|', '\\|').replace(/\r\n|\r|\n/g, '<br>');
  const line = (row: readonly Cell[]) => `| ${row.map(cell).join(' | ')} |`;
  return [line(columns), line(columns.map(() => '---')), ...rows.map(line)].join('\n');
}
