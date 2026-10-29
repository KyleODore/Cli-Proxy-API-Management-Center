import { describe, expect, test } from 'bun:test';
import { createCacheCollector } from '@/features/cache/useCacheCollector';
import type { UsageQueueBatch } from '@/services/api/usageQueue';

const empty: UsageQueueBatch = { events: [], rejectedRecords: 0, sourceRecords: 0 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('page-scoped cache collector', () => {
  test('concurrent polls share one request and scheduled polls use count 100', async () => {
    const pending = deferred<UsageQueueBatch>();
    const calls: Array<{ count: number; signal: AbortSignal }> = [];
    let scheduled!: () => void;
    const collector = createCacheCollector({
      captureConnection: () => ({ id: 'captured' }),
      pop: (_client, count, signal) => {
        calls.push({ count, signal });
        return pending.promise;
      },
      now: () => 1234,
      setTimer: (callback) => {
        scheduled = callback;
        return 1;
      },
      clearTimer: () => {},
      onSuccess: () => {},
      onError: () => {},
    });

    const stop = collector.start();
    void collector.poll();
    scheduled();
    expect(calls).toHaveLength(1);
    expect(calls[0].count).toBe(100);
    pending.resolve(empty);
    await collector.poll();
    stop();
  });

  test('stop aborts the in-flight request, clears the timer, and suppresses stale ingestion', async () => {
    const pending = deferred<UsageQueueBatch>();
    let signal!: AbortSignal;
    let cleared = 0;
    let successes = 0;
    let errors = 0;
    const collector = createCacheCollector({
      captureConnection: () => ({}),
      pop: (_client, _count, requestSignal) => {
        signal = requestSignal;
        return pending.promise;
      },
      setTimer: () => 9,
      clearTimer: (timer) => {
        expect(timer).toBe(9);
        cleared += 1;
      },
      onSuccess: () => {
        successes += 1;
      },
      onError: () => {
        errors += 1;
      },
    });

    const stop = collector.start();
    stop();
    expect(signal.aborted).toBe(true);
    expect(cleared).toBe(1);
    pending.resolve({
      events: [
        {
          at: 1,
          authIndex: 'a',
          provider: 'p',
          model: 'm',
          cacheReadTokens: 1,
          cacheWriteTokens: 1,
        },
      ],
      rejectedRecords: 0,
      sourceRecords: 1,
    });
    await collector.poll();
    expect(successes).toBe(0);
    expect(errors).toBe(0);
  });

  test('every successful empty poll emits a heartbeat timestamp', async () => {
    const successes: Array<{ batch: UsageQueueBatch; at: number }> = [];
    const collector = createCacheCollector({
      captureConnection: () => ({}),
      pop: async () => empty,
      now: () => 5678,
      setTimer: () => 1,
      clearTimer: () => {},
      onSuccess: (batch, at) => successes.push({ batch, at }),
      onError: () => {},
    });

    const stop = collector.start();
    await collector.poll();
    await collector.poll();
    stop();
    expect(successes).toEqual([
      { batch: empty, at: 5678 },
      { batch: empty, at: 5678 },
    ]);
  });

  test('a connection change aborts and suppresses a late successful batch', async () => {
    const pending = deferred<UsageQueueBatch>();
    let current = true;
    let successes = 0;
    const collector = createCacheCollector({
      captureConnection: () => ({}),
      isCurrent: () => current,
      pop: () => pending.promise,
      setTimer: () => 1,
      clearTimer: () => {},
      onSuccess: () => {
        successes += 1;
      },
      onError: () => {},
    });

    const stop = collector.start();
    current = false;
    pending.resolve(empty);
    await collector.poll();
    stop();
    expect(successes).toBe(0);
  });
});
