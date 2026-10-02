export function summarize(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const n = sorted.length;
  return n ? { count: n, min: sorted[0], max: sorted[n - 1], median: n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2 } : null;
}

export function barPosition(value, stats) {
  const min = Math.min(0, stats.min);
  const max = Math.max(0, stats.max);
  const range = max - min || 1;
  const zero = -min / range * 100;
  if (!Number.isFinite(value)) return { left: zero, width: 0, zero };
  return { left: (Math.min(0, value) - min) / range * 100, width: Math.abs(value) / range * 100, zero };
}
