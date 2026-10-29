import { apiClient } from './client';
import type { CacheUsageEvent } from '@/features/cache/types';

export interface UsageQueueBatch {
  events: CacheUsageEvent[];
  rejectedRecords: number;
  sourceRecords: number;
}

type Client = typeof apiClient;
type RecordValue = Record<string, unknown>;

function object(value: unknown): RecordValue | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

function identity(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' && value.trim() ? value : 'unknown';
}

function token(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function timestamp(value: unknown): number | null {
  const at =
    typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(at) ? at : null;
}

function sanitize(value: unknown): CacheUsageEvent | null {
  const record = object(value);
  if (!record) return null;
  const at = timestamp(record.timestamp);
  if (at === null) return null;

  const tokens = object(record.tokens) ?? {};
  const breakdown = object(record.token_breakdown) ?? {};
  const input = object(breakdown.input) ?? {};
  const cacheReadTokens =
    'cache_read_tokens' in tokens
      ? token(tokens.cache_read_tokens)
      : token(input.cache_read_tokens);
  const cacheWriteTokens =
    'cache_creation_tokens' in tokens
      ? token(tokens.cache_creation_tokens)
      : token(input.cache_write_tokens);

  return {
    at,
    authIndex: identity(record.auth_index),
    provider: identity(record.provider),
    model: identity(record.model),
    cacheReadTokens,
    cacheWriteTokens,
  };
}

export async function popUsageQueue(
  client: Client,
  count = 1,
  signal?: AbortSignal
): Promise<UsageQueueBatch> {
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new Error('Usage queue count must be a positive safe integer');
  }
  const response: unknown = await client.get('/observability/usage/queue', {
    params: { count },
    signal,
  });
  if (!Array.isArray(response)) throw new Error('Invalid usage queue response: expected an array');

  const events: CacheUsageEvent[] = [];
  let rejectedRecords = 0;
  for (const record of response) {
    const event = sanitize(record);
    if (event) events.push(event);
    else rejectedRecords += 1;
  }
  return { events, rejectedRecords, sourceRecords: response.length };
}

export const usageQueueApi: {
  pop(count?: number, signal?: AbortSignal): Promise<UsageQueueBatch>;
} = {
  pop: (count = 1, signal?: AbortSignal) => popUsageQueue(apiClient, count, signal),
};
