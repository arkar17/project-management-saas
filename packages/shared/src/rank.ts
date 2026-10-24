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

/** Key that sorts after every existing key (append to the end of a column). */
export const rankAfter = (last: string | null) => rankBetween(last, null);
