import { describe, expect, test } from 'bun:test';
import {
  aggregate,
  available,
  compactHistory,
  DAY,
  estimateBurn,
  HOUR,
  project,
  type PoolAccount,
  type Sample,
} from '../src/features/quota/pool/model';
import { normalizeAccount } from '../src/features/quota/pool/normalize';
import { readPassiveQuotaWindows } from '../src/services/api/quotaSignals';
import type { QuotaFileEntry } from '../src/features/quota/logic';
const NOW = 1_793_000_000_000;
const account = (id: string, remaining = 100, resetAt: number | null = NOW + DAY): PoolAccount => ({
  id,
  provider: 'claude',
  capacity: 100,
  windows: [{ id: 'weekly', remaining, resetAt }],
});
const pool = (...members: PoolAccount[]) => aggregate(members, NOW)[0];
const sample = (at: number, remaining: number, extra: Partial<Sample> = {}): Sample => ({
  at,
  remaining,
  signature: 's',
  capacity: 100,
  ...extra,
});

describe('prox discrete quota projection', () => {
  test('sums six ordinary accounts without averaging the capacity away', () => {
    expect(pool(...Array.from({ length: 6 }, (_, i) => account(`${i}`, 92.5)))).toMatchObject({
      capacity: 600,
      remaining: 555,
      unknown: 0,
    });
  });
  test('spends linearly and inserts exact depletion before a reset', () => {
    const result = project(pool(account('a', 50, NOW + 10 * HOUR)), NOW, NOW + 12 * HOUR, 10);
    expect(result.emptyAt).toBe(NOW + 5 * HOUR);
    expect(result.firstEmptyAt).toBe(NOW + 5 * HOUR);
    expect(result.points.find((p) => p.kind === 'empty')).toMatchObject({
      at: NOW + 5 * HOUR,
      value: 0,
    });
    const jump = result.points.findIndex((p) => p.kind === 'reset');
    expect(result.points[jump]).toMatchObject({ at: NOW + 10 * HOUR, value: 100, boost: 100 });
    expect(result.points[jump - 1]).toMatchObject({ at: NOW + 10 * HOUR, value: 0 });
    expect(result.points[result.points.length - 1].value).toBe(80);
  });
  test('an account reset restores actual consumed capacity, not a full additive grant', () => {
    const result = project(pool(account('a', 70, NOW + HOUR)), NOW, NOW + 2 * HOUR, 10);
    expect(result.points.find((p) => p.kind === 'reset')?.boost).toBe(40);
  });
  test('a secondary window can limit a short reset to a partial boost', () => {
    const a = account('a', 70);
    a.windows.push({ id: 'five-hour', remaining: 11, resetAt: NOW + HOUR, durationMs: 5 * HOUR });
    expect(
      project(pool(a), NOW, NOW + 2 * HOUR, 0).points.find((p) => p.kind === 'reset')?.boost
    ).toBe(59);
  });
  test('groups simultaneous resets into one atomic vertical jump', () => {
    const result = project(
      pool(account('a', 0, NOW + HOUR), account('b', 0, NOW + HOUR)),
      NOW,
      NOW + 2 * HOUR,
      0
    );
    expect(result.points.filter((p) => p.kind === 'reset')).toEqual([
      { at: NOW + HOUR, value: 200, kind: 'reset', boost: 200 },
    ]);
  });
  test('rolling short windows never create a fabricated repeated zigzag', () => {
    const a = account('a', 0, NOW + HOUR);
    a.windows[0].repeatMs = 5 * HOUR;
    expect(
      project(pool(a), NOW, NOW + 14 * DAY, 0).points.filter((p) => p.kind === 'reset')
    ).toHaveLength(1);
  });
  test('explicit weekly recurrence generates only scheduled macro resets', () => {
    const a = account('a', 100, NOW + DAY);
    a.windows[0].repeatMs = 7 * DAY;
    const result = project(pool(a), NOW, NOW + 14 * DAY, 1);
    expect(result.points.filter((p) => p.kind === 'reset').map((p) => p.at)).toEqual([
      NOW + DAY,
      NOW + 8 * DAY,
    ]);
  });
  test('calendar renewals release elapsed shorter sessions under the macro scenario', () => {
    const a = account('a', 0, NOW + DAY);
    a.windows[0].durationMs = 7 * DAY;
    a.windows.push({ id: 'five-hour', remaining: 0, resetAt: NOW + HOUR, durationMs: 5 * HOUR });
    const result = project(pool(a), NOW, NOW + 2 * DAY, 1);
    expect(result.points.find((p) => p.kind === 'reset')).toMatchObject({
      at: NOW + DAY,
      value: 100,
    });
  });
  test('cooldowns block capacity until their actual expiry', () => {
    const a = account('a', 100, null);
    a.blockedUntil = NOW + HOUR;
    expect(available(a, NOW)).toBe(0);
    const result = project(pool(a), NOW, NOW + 2 * HOUR, 1);
    expect(result.points.find((p) => p.kind === 'reset')).toMatchObject({
      at: NOW + HOUR,
      boost: 100,
    });
  });
  test('zero or negative burn never produces growth between resets', () => {
    const result = project(pool(account('a', 40, null)), NOW, NOW + DAY, -1);
    expect(result.emptyAt).toBeNull();
    expect(result.points.map((p) => p.value)).toEqual([40, 40]);
  });
  test('incomplete data never predicts an empty pool', () => {
    const a = account('a');
    a.windows = [];
    expect(project(pool(a), NOW, NOW + DAY, 10)).toEqual({
      points: [],
      emptyAt: null,
      firstEmptyAt: null,
    });
  });
  test('all vertices stay within exact pool bounds across varied scenarios', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const members = Array.from({ length: 6 }, (_, i) =>
        account(`${i}`, (seed * 17 + i * 13) % 101, NOW + (i + 1) * HOUR)
      );
      const p = pool(...members),
        result = project(p, NOW, NOW + 14 * DAY, seed / 10);
      for (let i = 0; i < result.points.length; i++) {
        const point = result.points[i];
        expect(point.value).toBeGreaterThanOrEqual(0);
        expect(point.value).toBeLessThanOrEqual(p.capacity);
        if (i) expect(point.at).toBeGreaterThanOrEqual(result.points[i - 1].at);
      }
    }
  });
});

describe('quota normalization and history', () => {
  const entry: QuotaFileEntry = { type: 'claude', file: { name: 'one.json', provider: 'claude' } };
  test('normalizes Claude fractions and expired windows', () => {
    const a = normalizeAccount(
      {
        ...entry,
        file: {
          ...entry.file,
          quota: {
            signals: {
              'anthropic-ratelimit-unified-5h-utilization': '0.45',
              'anthropic-ratelimit-unified-5h-reset': String((NOW - HOUR) / 1000),
            },
          },
        },
      },
      undefined,
      NOW
    )!;
    expect(a.windows[0].remaining).toBe(100);
  });
  test('disabled credentials do not contribute', () => {
    expect(
      normalizeAccount({ ...entry, file: { ...entry.file, disabled: true } }, undefined, NOW)
    ).toBeNull();
  });
  test('Codex Pro Max mixed pool is 450 points', () => {
    const entries = ['plus', 'plus', 'pro_max'].map((planType, i) =>
      normalizeAccount(
        {
          type: 'codex',
          file: {
            name: `${i}.json`,
            planType,
            quota: { signals: { 'x-codex-primary-used-percent': '10' } },
          },
        },
        undefined,
        NOW
      )!
    );
    expect(aggregate(entries, NOW)[0]).toMatchObject({ capacity: 450, remaining: 405 });
  });
  test('invalid/missing signals remain unknown', () => {
    expect(
      readPassiveQuotaWindows({ signals: { 'x-codex-primary-used-percent': '' } }, 'codex')
    ).toEqual([]);
    expect(normalizeAccount(entry, undefined, NOW)?.windows).toEqual([]);
  });
  test('never interprets a model cooldown as credential exhaustion', () => {
    const a = normalizeAccount(
      {
        ...entry,
        file: {
          ...entry.file,
          cooldownSnapshot: {
            receivedAtMs: NOW,
            records: [
              {
                scope: 'model',
                retryAt: new Date(NOW + HOUR).toISOString(),
                remainingSeconds: 3600,
                reason: 'quota',
              },
            ],
          },
        },
      },
      undefined,
      NOW
    )!;
    expect(a.blockedUntil).toBeUndefined();
  });
  test('calculates measured point-per-hour slope and ignores changed membership', () => {
    const rows = [sample(NOW - HOUR, 50), sample(NOW - HOUR + 30_000, 49.9), sample(NOW, 40)];
    expect(estimateBurn(rows, NOW, 3, 's')).toBeCloseTo(12); // long unmeasured gap excluded; valid 30s segment only
    expect(estimateBurn(rows, NOW, 3, 'other')).toBeNull();
  });
  test('falls back to reset-free slopes after a reset', () => {
    const rows = [
      sample(NOW - 90_000, 20),
      sample(NOW - 60_000, 19),
      sample(NOW - 30_000, 99),
      sample(NOW, 98),
    ];
    expect(estimateBurn(rows, NOW, 1, 's')).toBe(120);
  });
  test('excludes reset crossings even if net balance decreased', () => {
    const rows = [
      sample(NOW - 60_000, 90, { resetAt: NOW - 45_000 }),
      sample(NOW - 30_000, 80),
      sample(NOW, 79),
    ];
    expect(estimateBurn(rows, NOW, 1, 's')).toBe(120);
  });
  test('does not infer burn from one point or an offline gap', () => {
    expect(estimateBurn([sample(NOW, 50)], NOW, 3, 's')).toBeNull();
    expect(estimateBurn([sample(NOW - HOUR, 100), sample(NOW, 0)], NOW, 3, 's')).toBeNull();
  });
  test('retains bounded older data and high-resolution recent samples', () => {
    const rows = Array.from({ length: 18 * 24 * 120 }, (_, i) => sample(NOW - i * 30_000, 50));
    const result = compactHistory(rows, NOW);
    expect(result.length).toBeLessThan(6000);
    expect(result[0].at).toBeGreaterThanOrEqual(NOW - 17 * DAY);
    expect(result[result.length - 1].at).toBe(NOW);
  });
});
