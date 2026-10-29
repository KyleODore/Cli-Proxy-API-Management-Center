import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { apiClient } from '@/services/api/client';
import { usageQueueApi } from '@/services/api/usageQueue';

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  spies.splice(0).forEach((spy) => spy.mockRestore());
  mock.restore();
});

const record = {
  timestamp: '2026-10-28T12:00:00.000Z',
  auth_index: 7,
  provider: 'claude',
  model: 'claude-sonnet',
  tokens: { cache_read_tokens: 11, cache_creation_tokens: 13 },
};

describe('cache usage queue adapter', () => {
  test('calls the exact destructive endpoint with count and abort signal', async () => {
    const get = spyOn(apiClient, 'get').mockResolvedValue([]);
    spies.push(get);
    const signal = new AbortController().signal;

    expect(await usageQueueApi.pop(100, signal)).toEqual({
      events: [],
      rejectedRecords: 0,
      sourceRecords: 0,
    });
    expect(get).toHaveBeenCalledWith('/observability/usage/queue', {
      params: { count: 100 },
      signal,
    });
  });

  test('validates count before consuming records and requires an array response', async () => {
    const get = spyOn(apiClient, 'get').mockResolvedValue({ records: [] });
    spies.push(get);

    for (const count of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(usageQueueApi.pop(count)).rejects.toThrow('positive safe integer');
    }
    expect(get).not.toHaveBeenCalled();
    await expect(usageQueueApi.pop()).rejects.toThrow('array');
    expect(get).toHaveBeenCalledTimes(1);
  });

  test('prefers legacy cache fields without double counting canonical input', async () => {
    spyOn(apiClient, 'get').mockResolvedValue([
      {
        ...record,
        tokens: { cache_read_tokens: 11, cache_creation_tokens: 13 },
        token_breakdown: {
          input: { cache_read_tokens: 101, cache_write_tokens: 103 },
        },
      },
    ]);

    const batch = await usageQueueApi.pop(1);
    expect(batch.events[0]).toEqual({
      at: Date.parse(record.timestamp),
      authIndex: '7',
      provider: 'claude',
      model: 'claude-sonnet',
      cacheReadTokens: 11,
      cacheWriteTokens: 13,
    });
  });

  test('uses canonical input only when each legacy field is absent', async () => {
    spyOn(apiClient, 'get').mockResolvedValue([
      {
        ...record,
        tokens: { cache_read_tokens: 0 },
        token_breakdown: {
          input: { cache_read_tokens: 101, cache_write_tokens: 103 },
        },
      },
      {
        ...record,
        tokens: {},
        token_breakdown: {
          input: { cache_read_tokens: 0, cache_write_tokens: 0 },
        },
      },
      { ...record, tokens: {}, token_breakdown: { input: {} } },
    ]);

    const { events } = await usageQueueApi.pop(3);
    expect(events.map((event) => [event.cacheReadTokens, event.cacheWriteTokens])).toEqual([
      [0, 103],
      [0, 0],
      [null, null],
    ]);
  });

  test('rejects malformed timestamps and records while retaining valid siblings', async () => {
    spyOn(apiClient, 'get').mockResolvedValue([
      record,
      { ...record, timestamp: 'not-a-time' },
      { ...record, timestamp: null },
      null,
      'raw string',
    ]);

    const batch = await usageQueueApi.pop(5);
    expect(batch.events).toHaveLength(1);
    expect(batch.sourceRecords).toBe(5);
    expect(batch.rejectedRecords).toBe(4);
  });

  test('whitelists sanitized fields and uses unknown identities', async () => {
    spyOn(apiClient, 'get').mockResolvedValue([
      {
        timestamp: record.timestamp,
        tokens: { cache_read_tokens: 1 },
        api_key: 'secret-api-key',
        access_token_sha256: 'secret-access-token',
        client_ip: '192.0.2.1',
        user_agent: 'private-agent',
        response_headers: { authorization: 'secret-header' },
        fail: { body: 'secret-body' },
      },
    ]);

    const batch = await usageQueueApi.pop(1);
    expect(batch.events).toEqual([
      {
        at: Date.parse(record.timestamp),
        authIndex: 'unknown',
        provider: 'unknown',
        model: 'unknown',
        cacheReadTokens: 1,
        cacheWriteTokens: null,
      },
    ]);
    expect(JSON.stringify(batch)).not.toContain('secret-');
    expect(JSON.stringify(batch)).not.toContain('192.0.2.1');
    expect(Object.keys(batch.events[0]).sort()).toEqual([
      'at',
      'authIndex',
      'cacheReadTokens',
      'cacheWriteTokens',
      'model',
      'provider',
    ]);
  });
});
