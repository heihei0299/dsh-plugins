import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartTicks, formatAxisTicks, formatValue, truncateLabel } from '../src/client/chart.js';

test('chart ticks stay finite, ordered and cover ordinary, negative and extreme ranges', () => {
  const ranges: [number, number][] = [[0, 100], [-3, 0], [-1e12, 1e12], [1e12, 2e12], [0, 1e-300], [0, 0.02], [0, Number.MIN_VALUE]];
  for (const [low, high] of ranges) {
    const scale = chartTicks(low, high);
    assert.ok(Number.isFinite(scale.min) && Number.isFinite(scale.max), `${low}..${high}`);
    assert.ok(scale.min <= low && scale.max >= high, `${low}..${high} covers its input`);
    assert.ok(scale.ticks.length >= 2);
    for (const [index, tick] of scale.ticks.entries()) {
      assert.ok(Number.isFinite(tick), `${tick} is finite`);
      if (index > 0) assert.ok(tick > scale.ticks[index - 1]!, `${low}..${high} ticks are strictly increasing`);
    }
    const labels = formatAxisTicks(scale.ticks, scale.step);
    assert.equal(labels.length, scale.ticks.length);
    assert.equal(new Set(labels).size, labels.length, `${low}..${high} labels stay distinct`);
  }
});

test('a zero-width range gets a finite fallback instead of dividing by zero', () => {
  assert.deepEqual(chartTicks(5, 5), { min: 5, max: 6, ticks: [5, 5.5, 6], step: 0.5 });
  assert.deepEqual(chartTicks(0, 0), { min: 0, max: 1, ticks: [0, 0.5, 1], step: 0.5 });
});

test('axis labels use scientific notation only when compact labels would lose the value', () => {
  const fractional = formatAxisTicks([0, 0.005, 0.01, 0.015, 0.02], 0.005);
  assert.ok(fractional.includes('0.01'));
  assert.equal(new Set(fractional).size, fractional.length);
  for (const value of [1e-300, -1e12, 1e12]) {
    assert.match(formatValue(value), /[eE]/, `${value} should stay distinguishable`);
  }
  assert.equal(formatValue(0), '0');
  assert.equal(formatValue(-0), '0');
  assert.doesNotMatch(formatValue(1234), /\b(?:NaN|Infinity)\b/);
});

test('long category labels truncate by code point and keep short labels verbatim', () => {
  assert.equal(truncateLabel('12345678'), '12345678');
  assert.equal(truncateLabel('123456789'), '1234567…');
  const emoji = '😀'.repeat(9);
  const shortened = truncateLabel(emoji);
  assert.equal(Array.from(shortened).length, 8);
  assert.ok(shortened.endsWith('…'));
  assert.equal(truncateLabel('😀'.repeat(8)), '😀'.repeat(8));
});
