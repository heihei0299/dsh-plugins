/**
 * Chart geometry and labels, separate from React so the numeric edge cases can
 * be tested directly. No component in this module touches the DOM.
 */

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
export function formatValue(value: number): string {
  if (value === 0) return '0';
  const magnitude = Math.abs(value);
  return magnitude < 1e-4 || magnitude >= 1e12 ? scientificNumber(3).format(value) : compactNumber.format(value);
}

export function formatAxisTicks(ticks: readonly number[], step: number): string[] {
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
export function chartTicks(low: number, high: number): { min: number; max: number; ticks: number[]; step: number } {
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

export function truncateLabel(label: string): string {
  const characters = Array.from(label);
  return characters.length > 8 ? `${characters.slice(0, 7).join('')}…` : label;
}
