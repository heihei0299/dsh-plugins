import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportTable, visibleTableRows } from '../src/shared/table.js';
import { nextTabIndex } from '../src/client/GroupView.js';
import type { Cell } from '../src/shared/types.js';

test('local filtering matches all columns and preserves immutable recorded rows', () => {
  const rows: Cell[][] = [['Alpha', 20, true], ['Beta', 3, null], ['服务 A', 0, false]];
  const original = structuredClone(rows);
  assert.deepEqual(visibleTableRows(rows, ' ALP ', null), [rows[0]]);
  assert.deepEqual(visibleTableRows(rows, '服务', null), [rows[2]]);
  assert.deepEqual(visibleTableRows(rows, 'false', null), [rows[2]]);
  assert.deepEqual(visibleTableRows(rows, 'missing', null), []);
  assert.deepEqual(visibleTableRows(rows, '', { column: 1, direction: 1 }), [rows[2], rows[1], rows[0]]);
  assert.deepEqual(visibleTableRows(rows, 'a', { column: 1, direction: -1 }), [rows[0], rows[1], rows[2]]);
  assert.deepEqual(rows, original);
  assert.notEqual(visibleTableRows(rows, '', null), rows);
});
test('CSV includes headings, quotes multiline cells and neutralizes text formulas', () => {
  const csv = exportTable(['=unsafe', 'Name'], [[' @cmd', 'a,"b"\r\nc'], [-2, false], [null, '\t+SUM(A1)']], 'csv');
  assert.equal(csv, '"\'=unsafe","Name"\r\n"\' @cmd","a,""b""\r\nc"\r\n"-2","false"\r\n"—","\'\t+SUM(A1)"');
  for (const prefix of ['=', '+', '-', '@', ' \t=', '\r\n@', '\uFEFF+']) {
    assert.ok(exportTable(['Header'], [[`${prefix}payload`]], 'csv').includes(`"'${prefix}payload"`));
  }
});
test('TSV and CSV share text-only formula protection and keep typed values unchanged', () => {
  const columns = ['-2', '=unsafe', ' @cmd'];
  const rows: Cell[][] = [
    [-2, 0, -1.5],
    ['-2', '-71', '=SUM(A1)'],
    ['line\tbreak', 'line\nbreak', '@cmd'],
    [false, true, null],
  ];
  const tsv = exportTable(columns, rows, 'tsv');
  const csv = exportTable(columns, rows, 'csv');
  assert.deepEqual(tsv.split('\n'), [
    "'-2\t'=unsafe\t' @cmd",
    '-2\t0\t-1.5',
    "'-2\t'-71\t'=SUM(A1)",
    "line break\tline break\t'@cmd",
    'false\ttrue\t—',
  ]);
  assert.deepEqual(csv.split('\r\n'), [
    '"\'-2","\'=unsafe","\' @cmd"',
    '"-2","0","-1.5"',
    '"\'-2","\'-71","\'=SUM(A1)"',
    '"line\tbreak","line\nbreak","\'@cmd"',
    '"false","true","—"',
  ]);
});
test('exports use only the filtered view and current sort, including empty results', () => {
  const rows: Cell[][] = [['show', 2], ['hide', 100], ['show', 1]];
  const visible = visibleTableRows(rows, 'show', { column: 1, direction: 1 });
  assert.equal(exportTable(['Name', 'Value'], visible, 'csv'), '"Name","Value"\r\n"show","1"\r\n"show","2"');
  assert.equal(exportTable(['Name'], [], 'csv'), '"Name"');
  assert.equal(exportTable(['Name'], [], 'markdown'), '| Name |\n| --- |');
  assert.equal(exportTable(['Name'], [['=SUM(A1)']], 'tsv'), "Name\n'=SUM(A1)");
});
test('Markdown export escapes pipes, backslashes, HTML and embedded newlines', () => {
  assert.equal(exportTable(['A|B'], [['x\\y|z\r\n<img>&']], 'markdown'), '| A\\|B |\n| --- |\n| x\\\\y\\|z<br>&lt;img&gt;&amp; |');
});
test('tabs use roving focus with wraparound and Home/End without intercepting other keys', () => {
  assert.equal(nextTabIndex('ArrowRight', 2, 3), 0);
  assert.equal(nextTabIndex('ArrowLeft', 0, 3), 2);
  assert.equal(nextTabIndex('Home', 2, 3), 0);
  assert.equal(nextTabIndex('End', 0, 3), 2);
  assert.equal(nextTabIndex('ArrowRight', 0, 1), 0);
  assert.equal(nextTabIndex('Tab', 0, 3), null);
  assert.equal(nextTabIndex('ArrowRight', 0, 0), null);
});
