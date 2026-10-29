export interface CacheUsageEvent {
  at: number;
  authIndex: string;
  provider: string;
  model: string;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
}

export interface CacheHistoryBucket {
  at: number;
  authIndex: string;
  provider: string;
  model: string;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  eventCount: number;
  readCount: number;
  writeCount: number;
}

export interface CacheHistory {
  version: 1;
  buckets: CacheHistoryBucket[];
  heartbeats: number[];
}

export type CacheRange = '24h' | '7d' | '17d';

export interface CacheTotals {
  cacheReadTokens: number;
  cacheWriteTokens: number;
  readPartial: boolean;
  writePartial: boolean;
}

export interface CacheGroup extends CacheTotals {
  authIndex: string;
  provider: string;
  model: string;
}

export interface CachePoint {
  at: number;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  readPartial: boolean;
  writePartial: boolean;
}

export interface CacheModel {
  totals: CacheTotals;
  rows: CacheGroup[];
  series: CachePoint[];
}
