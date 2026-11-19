// Admin list filters: "1w" | "1m" | "6m" | "1y" -> the date that range starts at (null = all time).
export const DATE_RANGES = ['1w', '1m', '6m', '1y'];

export function rangeStart(range, now = new Date()) {
  if (!DATE_RANGES.includes(range)) return null;
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (range === '1w') d.setDate(d.getDate() - 7);
  else if (range === '1m') d.setMonth(d.getMonth() - 1);
  else if (range === '6m') d.setMonth(d.getMonth() - 6);
  else d.setFullYear(d.getFullYear() - 1);
  return d;
}
