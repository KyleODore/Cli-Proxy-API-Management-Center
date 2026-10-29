import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { UsageQueueBatch } from '@/services/api/usageQueue';
import type { CacheHistory, CacheHistoryBucket } from './types';

export const CACHE_RETENTION_MS = 17 * 86_400_000;
export const CACHE_DETAIL_MS = 6 * 3_600_000;
export const CACHE_DETAIL_BUCKET_MS = 30_000;
export const CACHE_COMPACT_BUCKET_MS = 300_000;

export const emptyCacheHistory = (): CacheHistory => ({ version: 1, buckets: [], heartbeats: [] });

function bucketSize(at: number, now: number): number {
  return now - at <= CACHE_DETAIL_MS ? CACHE_DETAIL_BUCKET_MS : CACHE_COMPACT_BUCKET_MS;
}

function bucketAt(at: number, now: number): number {
  const size = bucketSize(at, now);
  return Math.floor(at / size) * size;
}

function merge(target: CacheHistoryBucket, source: CacheHistoryBucket): void {
  target.cacheReadTokens += source.cacheReadTokens;
  target.cacheWriteTokens += source.cacheWriteTokens;
  target.eventCount += source.eventCount;
  target.readCount += source.readCount;
  target.writeCount += source.writeCount;
}

export function compactCacheHistory(history: CacheHistory, now: number): CacheHistory {
  const cutoff = now - CACHE_RETENTION_MS;
  const grouped = new Map<string, CacheHistoryBucket>();
  for (const bucket of history.buckets) {
    if (!Number.isFinite(bucket.at) || bucket.at < cutoff || bucket.at > now) continue;
    const at = bucketAt(bucket.at, now);
    const key = JSON.stringify([at, bucket.authIndex, bucket.provider, bucket.model]);
    const existing = grouped.get(key);
    if (existing) merge(existing, bucket);
    else grouped.set(key, { ...bucket, at });
  }
  const heartbeats = [
    ...new Set(
      history.heartbeats
        .filter((at) => Number.isFinite(at) && at >= cutoff && at <= now)
        .map((at) => bucketAt(at, now))
    ),
  ].sort((a, b) => a - b);
  return {
    version: 1,
    buckets: [...grouped.values()].sort(
      (a, b) => a.at - b.at || a.authIndex.localeCompare(b.authIndex)
    ),
    heartbeats,
  };
}

export function applyCacheSuccess(
  history: CacheHistory,
  batch: UsageQueueBatch,
  heartbeatAt: number,
  now: number
): CacheHistory {
  const additions = batch.events.map((event): CacheHistoryBucket => {
    const at = bucketAt(event.at, now);
    return {
      at,
      authIndex: event.authIndex,
      provider: event.provider,
      model: event.model,
      cacheReadTokens: event.cacheReadTokens ?? 0,
      cacheWriteTokens: event.cacheWriteTokens ?? 0,
      eventCount: 1,
      readCount: event.cacheReadTokens === null ? 0 : 1,
      writeCount: event.cacheWriteTokens === null ? 0 : 1,
    };
  });
  return compactCacheHistory(
    {
      version: 1,
      buckets: [...history.buckets, ...additions],
      heartbeats: [...history.heartbeats, heartbeatAt],
    },
    now
  );
}

export function cacheHistoryStorageKey(apiBase: string, managementKey: string): string {
  const digest = sha256(new TextEncoder().encode(`${apiBase}\0${managementKey}`));
  return `prox.cache-history.v1.${bytesToHex(digest)}`;
}

function validBucket(value: unknown): value is CacheHistoryBucket {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const bucket = value as Record<string, unknown>;
  return (
    typeof bucket.at === 'number' &&
    Number.isFinite(bucket.at) &&
    typeof bucket.authIndex === 'string' &&
    typeof bucket.provider === 'string' &&
    typeof bucket.model === 'string' &&
    ['cacheReadTokens', 'cacheWriteTokens', 'eventCount', 'readCount', 'writeCount'].every(
      (key) => typeof bucket[key] === 'number' && Number.isFinite(bucket[key])
    )
  );
}

export function decodeCacheHistory(raw: string): CacheHistory {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyCacheHistory();
    const parsed = value as Record<string, unknown>;
    if (
      parsed.version !== 1 ||
      !Array.isArray(parsed.buckets) ||
      !Array.isArray(parsed.heartbeats)
    ) {
      return emptyCacheHistory();
    }
    return {
      version: 1,
      buckets: parsed.buckets.filter(validBucket).map((bucket) => ({
        at: bucket.at,
        authIndex: bucket.authIndex,
        provider: bucket.provider,
        model: bucket.model,
        cacheReadTokens: bucket.cacheReadTokens,
        cacheWriteTokens: bucket.cacheWriteTokens,
        eventCount: bucket.eventCount,
        readCount: bucket.readCount,
        writeCount: bucket.writeCount,
      })),
      heartbeats: parsed.heartbeats.filter(
        (at): at is number => typeof at === 'number' && Number.isFinite(at)
      ),
    };
  } catch {
    return emptyCacheHistory();
  }
}

export function encodeCacheHistory(history: CacheHistory): string {
  return JSON.stringify({
    version: 1,
    buckets: history.buckets,
    heartbeats: history.heartbeats,
  });
}
