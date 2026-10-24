import { describe, expect, it } from 'vitest';
import {
  ISSUE_TYPES,
  childrenError,
  createIssueInput,
  hierarchyError,
  parseMentions,
  sanitizeMarkdown,
  updateIssueInput,
  type IssueType,
} from './issues.js';
import { MAX_RANK_LENGTH, evenRanks, rankAfter, rankBetween } from './rank.js';

describe('TC-ISS-004-1 hierarchy matrix (ADR-006)', () => {
  const allowed: Record<string, IssueType[]> = {
    EPIC: ['STORY', 'TASK', 'BUG'],
    STORY: ['SUBTASK'],
    TASK: ['SUBTASK'],
    BUG: [],
    SUBTASK: [],
  };
  it.each(ISSUE_TYPES)('parent %s accepts exactly its allowed children', (parent) => {
    for (const child of ISSUE_TYPES) {
      expect(hierarchyError(child, parent) === null, `${parent}→${child}`).toBe(
        allowed[parent]!.includes(child),
      );
    }
  });
  it('EPIC has no parent; SUBTASK requires one; others may be top-level', () => {
    expect(hierarchyError('SUBTASK', null)).not.toBeNull();
    for (const t of ['EPIC', 'STORY', 'TASK', 'BUG'] as const)
      expect(hierarchyError(t, null)).toBeNull();
  });
  it('type change must keep existing children valid', () => {
    expect(childrenError('BUG', ['SUBTASK'])).not.toBeNull();
    expect(childrenError('TASK', ['SUBTASK'])).toBeNull();
    expect(childrenError('EPIC', ['STORY', 'BUG'])).toBeNull();
  });
});

describe('TC-ISS-002-1 input rules', () => {
  it('sanitises Markdown: strips HTML and script links, keeps text', () => {
    expect(sanitizeMarkdown('Hi <script>alert(1)</script>**bold** <img src=x onerror=y>')).toBe(
      'Hi alert(1)**bold**',
    );
    expect(sanitizeMarkdown('[x](javascript:alert(1)) [ok](https://a.b)')).toBe(
      '[x](#) [ok](https://a.b)',
    );
    expect(
      createIssueInput.parse({ type: 'TASK', title: 'T', description: '<b>x</b>' }).description,
    ).toBe('x');
  });
  it('story points are integers 0–100 or null', () => {
    for (const p of [0, 100, null])
      expect(createIssueInput.safeParse({ type: 'TASK', title: 'T', storyPoints: p }).success).toBe(
        true,
      );
    for (const p of [-1, 101, 2.5])
      expect(createIssueInput.safeParse({ type: 'TASK', title: 'T', storyPoints: p }).success).toBe(
        false,
      );
  });
  it('TC-ISS-001-2 PATCH rejects projectId and key; version required', () => {
    expect(
      updateIssueInput.safeParse({ version: 1, projectId: '00000000-0000-4000-8000-000000000000' })
        .success,
    ).toBe(false);
    expect(updateIssueInput.safeParse({ version: 1, key: 'X-1' }).success).toBe(false);
    expect(updateIssueInput.safeParse({ title: 'x' }).success).toBe(false);
    expect(updateIssueInput.safeParse({ version: 1, title: 'x' }).success).toBe(true);
  });
  it('parses email mentions, deduplicated and lower-cased', () => {
    expect(
      parseMentions('cc @Ada@Acme.test and @bob@acme.test, @ada@acme.test; mail me@x.test'),
    ).toEqual(['ada@acme.test', 'bob@acme.test']);
  });
});

describe('fractional ranks (ADR-016)', () => {
  it('produces strictly ordered keys between neighbours and at the ends', () => {
    const a = rankBetween(null, null);
    const b = rankAfter(a);
    expect(b > a).toBe(true);
    const mid = rankBetween(a, b);
    expect(mid > a && mid < b).toBe(true);
    let last = a;
    for (let i = 0; i < 200; i++) {
      const next = rankAfter(last);
      expect(next > last).toBe(true);
      last = next;
    }
    expect(last.length).toBeLessThanOrEqual(64);
    let lo = 'a';
    const hi = 'b';
    for (let i = 0; i < 30; i++) {
      const m = rankBetween(lo, hi);
      expect(m > lo && m < hi).toBe(true);
      lo = m;
    }
  });
});

describe('append keys stay short', () => {
  it('10 000 consecutive appends stay strictly ordered and under the rebalance limit', () => {
    let last: string | null = null;
    for (let i = 0; i < 10_000; i++) {
      const next = rankAfter(last);
      if (last !== null) expect(next > last).toBe(true);
      last = next;
    }
    expect(last!.length).toBeLessThan(MAX_RANK_LENGTH);
  });
});

describe('rank rebalancing keys', () => {
  it.each([1, 5, 36, 1000, 50_000])(
    'evenRanks(%i) is strictly ascending, fixed width and short',
    (n) => {
      const keys = evenRanks(n);
      expect(keys).toHaveLength(n);
      for (let i = 1; i < n; i++) expect(keys[i]! > keys[i - 1]!).toBe(true);
      expect(new Set(keys.map((k) => k.length)).size).toBe(1);
      expect(keys[0]!.length).toBeLessThan(MAX_RANK_LENGTH);
      // Room remains between neighbours and at both ends.
      expect(rankBetween(null, keys[0]!) < keys[0]!).toBe(true);
      if (n > 1) expect(rankBetween(keys[0]!, keys[1]!) > keys[0]!).toBe(true);
    },
  );
});
