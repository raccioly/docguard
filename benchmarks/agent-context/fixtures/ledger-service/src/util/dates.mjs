const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole calendar days from `from` to `to` (ISO dates, UTC). Negative when `to` is earlier. */
export function daysBetween(from, to) {
  const a = Date.UTC(...ymd(from));
  const b = Date.UTC(...ymd(to));
  return Math.round((b - a) / DAY_MS);
}

function ymd(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return [y, m - 1, d];
}
