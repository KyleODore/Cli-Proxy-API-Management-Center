import {
  CACHE_COMPACT_BUCKET_MS,
  CACHE_DETAIL_BUCKET_MS,
  CACHE_DETAIL_MS,
  CACHE_RETENTION_MS,
} from './history';
import type {
  CacheGroup,
  CacheHistory,
  CacheHistoryBucket,
  CacheModel,
  CachePoint,
  CacheRange,
  CacheTotals,
} from './types';

const RANGE_MS: Record<CacheRange, number> = {
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '17d': CACHE_RETENTION_MS,
};

function emptyTotals(): CacheTotals {
  return { cacheReadTokens: 0, cacheWriteTokens: 0, readPartial: false, writePartial: false };
}

function add(target: CacheTotals, bucket: CacheHistoryBucket): void {
  target.cacheReadTokens += bucket.cacheReadTokens;
  target.cacheWriteTokens += bucket.cacheWriteTokens;
  target.readPartial ||= bucket.readCount < bucket.eventCount;
  target.writePartial ||= bucket.writeCount < bucket.eventCount;
}

function seriesTimes(now: number, range: CacheRange): number[] {
  const end = Math.floor(now / CACHE_DETAIL_BUCKET_MS) * CACHE_DETAIL_BUCKET_MS;
  const start = end - RANGE_MS[range];
  const detailStart = end - CACHE_DETAIL_MS;
  const times: number[] = [];
  for (let at = start; at <= end;) {
    times.push(at);
    at += range === '24h' && at >= detailStart ? CACHE_DETAIL_BUCKET_MS : CACHE_COMPACT_BUCKET_MS;
  }
  return times;
}

export function buildCacheModel(history: CacheHistory, now: number, range: CacheRange): CacheModel {
  const times = seriesTimes(now, range);
  const start = times[0];
  const end = times[times.length - 1];
  const relevant = history.buckets.filter((bucket) => bucket.at >= start && bucket.at <= end);
  const totals = emptyTotals();
  const groups = new Map<string, CacheGroup>();
  for (const bucket of relevant) {
    add(totals, bucket);
    const key = JSON.stringify([bucket.authIndex, bucket.provider, bucket.model]);
    const group = groups.get(key) ?? {
      authIndex: bucket.authIndex,
      provider: bucket.provider,
      model: bucket.model,
      ...emptyTotals(),
    };
    add(group, bucket);
    groups.set(key, group);
  }

  const series: CachePoint[] = times.map((at, index) => {
    const next = times[index + 1] ?? at + 1;
    const buckets = relevant.filter((bucket) => bucket.at >= at && bucket.at < next);
    const covered =
      buckets.length > 0 ||
      history.heartbeats.some((heartbeat) => heartbeat >= at && heartbeat < next);
    if (!covered) {
      return {
        at,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        readPartial: false,
        writePartial: false,
      };
    }
    const pointTotals = emptyTotals();
    buckets.forEach((bucket) => add(pointTotals, bucket));
    return { at, ...pointTotals };
  });

  return {
    totals,
    rows: [...groups.values()].sort(
      (a, b) =>
        b.cacheReadTokens + b.cacheWriteTokens - (a.cacheReadTokens + a.cacheWriteTokens) ||
        a.authIndex.localeCompare(b.authIndex)
    ),
    series,
  };
}
