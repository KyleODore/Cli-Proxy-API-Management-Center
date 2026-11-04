import { describe, expect, test } from 'bun:test';
import { applyCacheSuccess, emptyCacheHistory } from '@/features/cache/history';
import { buildCacheModel } from '@/features/cache/model';
import type { CacheUsageEvent } from '@/features/cache/types';

const NOW = 1_800_000_000_000;
const bucket = (at: number) => Math.floor(at / 30_000) * 30_000;
const event = (at: number, overrides: Partial<CacheUsageEvent> = {}): CacheUsageEvent => ({
  at,
  authIndex: 'credential-1',
  provider: 'claude',
  model: 'sonnet',
  cacheReadTokens: 10,
  cacheWriteTokens: 20,
  ...overrides,
});

describe('gap-aware cache model', () => {
  test('covered empty buckets are zero and uncovered restart or downtime buckets are null', () => {
    const coveredAt = NOW - 60_000;
    const downtimeAt = NOW - 30_000;
    let history = applyCacheSuccess(
      emptyCacheHistory(),
      { events: [], rejectedRecords: 0, sourceRecords: 0 },
      coveredAt,
      NOW
    );
    history = applyCacheSuccess(
      history,
      { events: [event(NOW)], rejectedRecords: 0, sourceRecords: 1 },
      NOW,
      NOW
    );

    const model = buildCacheModel(history, NOW, '24h');
    expect(model.series.find((point) => point.at === bucket(coveredAt))).toMatchObject({
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(model.series.find((point) => point.at === bucket(downtimeAt))).toMatchObject({
      cacheReadTokens: null,
      cacheWriteTokens: null,
    });
    expect(model.series.find((point) => point.at === bucket(NOW))).toMatchObject({
      cacheReadTokens: 10,
      cacheWriteTokens: 20,
    });
  });

  test('totals and grouped rows preserve known values while marking partial data', () => {
    const history = applyCacheSuccess(
      emptyCacheHistory(),
      {
        events: [
          event(NOW, { cacheReadTokens: null }),
          event(NOW, { cacheReadTokens: 5 }),
          event(NOW, { authIndex: 'credential-2', model: 'unknown', cacheWriteTokens: null }),
        ],
        rejectedRecords: 0,
        sourceRecords: 3,
      },
      NOW,
      NOW
    );

    const model = buildCacheModel(history, NOW, '24h');
    expect(model.totals).toEqual({
      cacheReadTokens: 15,
      cacheWriteTokens: 40,
      readPartial: true,
      writePartial: true,
    });
    expect(model.rows).toHaveLength(2);
    expect(model.rows.find((row) => row.authIndex === 'credential-1')).toMatchObject({
      cacheReadTokens: 5,
      cacheWriteTokens: 40,
      readPartial: true,
      writePartial: false,
    });
    expect(model.rows.find((row) => row.authIndex === 'credential-2')).toMatchObject({
      model: 'unknown',
      readPartial: false,
      writePartial: true,
    });
  });

  test('supports twenty-four-hour, seven-day, and seventeen-day ranges', () => {
    const history = emptyCacheHistory();
    expect(buildCacheModel(history, NOW, '24h').series).toHaveLength(18 * 12 + 6 * 120 + 1);
    expect(buildCacheModel(history, NOW, '7d').series).toHaveLength(7 * 24 * 12 + 1);
    expect(buildCacheModel(history, NOW, '17d').series).toHaveLength(17 * 24 * 12 + 1);
  });
});
