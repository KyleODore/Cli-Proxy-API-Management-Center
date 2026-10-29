import { describe, expect, test } from 'bun:test';
import {
  applyCacheSuccess,
  cacheHistoryStorageKey,
  compactCacheHistory,
  decodeCacheHistory,
  emptyCacheHistory,
  encodeCacheHistory,
} from '@/features/cache/history';
import type { CacheUsageEvent } from '@/features/cache/types';

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const event = (at: number, overrides: Partial<CacheUsageEvent> = {}): CacheUsageEvent => ({
  at,
  authIndex: 'credential-1',
  provider: 'claude',
  model: 'sonnet',
  cacheReadTokens: 10,
  cacheWriteTokens: 20,
  ...overrides,
});

describe('sanitized cache history', () => {
  test('prunes data and heartbeats older than seventeen days', () => {
    let history = applyCacheSuccess(
      emptyCacheHistory(),
      {
        events: [event(NOW - 17 * DAY - 1), event(NOW - 17 * DAY + 1)],
        rejectedRecords: 0,
        sourceRecords: 2,
      },
      NOW,
      NOW
    );
    history = {
      ...history,
      heartbeats: [NOW - 17 * DAY - 1, NOW - 17 * DAY + 1, ...history.heartbeats],
    };

    const compacted = compactCacheHistory(history, NOW);
    expect(compacted.buckets.map((bucket) => bucket.at)).toEqual([
      Math.floor((NOW - 17 * DAY + 1) / 300_000) * 300_000,
    ]);
    expect(compacted.heartbeats.every((at) => at >= NOW - 17 * DAY)).toBe(true);
  });

  test('keeps thirty-second buckets for six hours and compacts older data to five minutes', () => {
    const recentAt = NOW - 60_000;
    const oldAt = NOW - 7 * 3_600_000;
    const history = applyCacheSuccess(
      emptyCacheHistory(),
      {
        events: [
          event(recentAt),
          event(recentAt + 30_000, { cacheReadTokens: 1, cacheWriteTokens: 2 }),
          event(oldAt),
          event(oldAt + 60_000, { cacheReadTokens: 3, cacheWriteTokens: 4 }),
        ],
        rejectedRecords: 0,
        sourceRecords: 4,
      },
      NOW,
      NOW
    );

    const recent = history.buckets.filter((bucket) => bucket.at >= NOW - 6 * 3_600_000);
    const older = history.buckets.filter((bucket) => bucket.at < NOW - 6 * 3_600_000);
    expect(recent).toHaveLength(2);
    expect(recent.every((bucket) => bucket.at % 30_000 === 0)).toBe(true);
    expect(older).toHaveLength(1);
    expect(older[0].at % 300_000).toBe(0);
    expect(older[0].cacheReadTokens).toBe(13);
    expect(older[0].cacheWriteTokens).toBe(24);
    expect(older[0].eventCount).toBe(2);
  });

  test('aggregates independently by credential, provider, and model and tracks partial fields', () => {
    const at = NOW - 1000;
    const history = applyCacheSuccess(
      emptyCacheHistory(),
      {
        events: [
          event(at, { cacheReadTokens: null }),
          event(at, { cacheReadTokens: 5 }),
          event(at, { authIndex: 'credential-2', model: 'opus', cacheWriteTokens: null }),
        ],
        rejectedRecords: 0,
        sourceRecords: 3,
      },
      NOW,
      NOW
    );

    expect(history.buckets).toHaveLength(2);
    const first = history.buckets.find((bucket) => bucket.authIndex === 'credential-1')!;
    expect(first).toMatchObject({
      cacheReadTokens: 5,
      cacheWriteTokens: 40,
      eventCount: 2,
      readCount: 1,
      writeCount: 2,
    });
    const second = history.buckets.find((bucket) => bucket.authIndex === 'credential-2')!;
    expect(second.writeCount).toBe(0);
  });

  test('scopes storage by connection and principal without persisting either secret', () => {
    const first = cacheHistoryStorageKey('https://one.invalid', 'first-management-secret');
    const second = cacheHistoryStorageKey('https://one.invalid', 'second-management-secret');
    const other = cacheHistoryStorageKey('https://two.invalid', 'first-management-secret');
    expect(first).toMatch(/^prox\.cache-history\.v1\.[a-f0-9]{64}$/);
    expect(new Set([first, second, other]).size).toBe(3);
    expect(first).not.toContain('first-management-secret');
  });

  test('round trips only sanitized aggregates and heartbeats, never raw payloads or keys', () => {
    const history = applyCacheSuccess(
      emptyCacheHistory(),
      {
        events: [event(NOW - 1000, { cacheReadTokens: null })],
        rejectedRecords: 1,
        sourceRecords: 2,
      },
      NOW,
      NOW
    );
    const encoded = encodeCacheHistory(history);
    const decoded = decodeCacheHistory(encoded);

    expect(decoded).toEqual(history);
    expect(Object.keys(decoded).sort()).toEqual(['buckets', 'heartbeats', 'version']);
    expect(encoded).not.toContain('api_key');
    expect(encoded).not.toContain('tokens');
    expect(encoded).not.toContain('management');
    expect(encoded).not.toContain('rejectedRecords');
    expect(decodeCacheHistory('{broken')).toEqual(emptyCacheHistory());
    expect(decodeCacheHistory('{"version":2,"buckets":[],"heartbeats":[]}')).toEqual(
      emptyCacheHistory()
    );
  });

  test('records empty successful polls as compacted coverage heartbeats', () => {
    let history = emptyCacheHistory();
    history = applyCacheSuccess(
      history,
      { events: [], rejectedRecords: 0, sourceRecords: 0 },
      NOW - 1000,
      NOW
    );
    history = applyCacheSuccess(
      history,
      { events: [], rejectedRecords: 0, sourceRecords: 0 },
      NOW - 2000,
      NOW
    );
    expect(history.buckets).toEqual([]);
    expect(history.heartbeats).toEqual([Math.floor((NOW - 1000) / 30_000) * 30_000]);
  });
});
