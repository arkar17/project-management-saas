/**
 * Fractional rank keys (ADR-016): lower-case base-36 strings compared byte-wise
 * (collation "C"). rankBetween(a, b) returns a key strictly between a and b; null means
 * an open end. Keys only grow when inserting between close neighbours; G3 rebalances >64.
 */
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;
const MID = DIGITS[Math.floor(BASE / 2)]!;

const digit = (s: string, i: number, fallback: number) =>
  i < s.length ? DIGITS.indexOf(s[i]!) : fallback;

export function rankBetween(a: string | null, b: string | null): string {
  if (a !== null && b !== null && a >= b) throw new Error('rankBetween: a must sort before b');
  if (a === null && b === null) return MID;
  let result = '';
  for (let i = 0; ; i++) {
    const lo = a === null ? 0 : digit(a, i, 0);
    const hi = b === null ? BASE : digit(b, i, BASE);
    if (lo === hi) {
      result += DIGITS[lo];
      continue;
    }
    const mid = Math.floor((lo + hi) / 2);
    if (mid > lo) return result + DIGITS[mid];
    // Adjacent digits: keep lo and look for room in the next position (b no longer bounds).
    result += DIGITS[lo];
    const rest = a === null ? '' : a.slice(i + 1);
    return result + rankBetween(rest === '' ? null : rest, null);
  }
}

/** First append key: four digits, starting mid-space, leaves ~800k appends of headroom. */
const APPEND_START = MID + '000';

/**
 * Key after `last` for appends: `last` + 1 as a same-width base-36 number, so appends never
 * lengthen keys until the width is exhausted (then one digit is added). Rebalancing
 * (evenRanks) restores headroom.
 */
export function rankAfter(last: string | null): string {
  if (last === null) return APPEND_START;
  const digits = [...last].map((c) => DIGITS.indexOf(c));
  for (let i = digits.length - 1; i >= 0; i--) {
    if (digits[i]! < BASE - 1) {
      digits[i]!++;
      return digits.map((d) => DIGITS[d]).join('');
    }
    digits[i] = 0;
  }
  return last + MID;
}

/** Keys longer than this trigger a rebalance of the project's ranks (ADR-016). */
export const MAX_RANK_LENGTH = 64;

/** n evenly spaced, fixed-width keys in ascending order, used when rebalancing. */
export function evenRanks(n: number): string[] {
  // Two spare digits and only the lower half of the space: room for inserts between
  // neighbours and for many appends (rankAfter) before the next rebalance.
  const width = Math.max(4, Math.ceil(Math.log(n + 2) / Math.log(BASE)) + 2);
  const space = BASE ** width;
  const step = Math.floor(space / 2 / (n + 1));
  return Array.from({ length: n }, (_, i) => ((i + 1) * step).toString(36).padStart(width, '0'));
}
