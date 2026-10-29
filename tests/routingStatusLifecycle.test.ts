import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { runRoutingStrategySave } from '@/features/routing/useRoutingStatus';
import { apiClient } from '@/services/api/client';
import { routingApi } from '@/services/api/routing';

const spies: Array<{ mockRestore(): void }> = [];

afterEach(() => {
  spies.splice(0).forEach((spy) => spy.mockRestore());
  apiClient.setConfig({ apiBase: '', managementKey: '' });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function saveHarness() {
  const events: string[] = [];
  let operation = 0;
  const start = () => {
    const requestId = ++operation;
    const revision = apiClient.getConnectionRevision();
    return runRoutingStrategySave('soonest-reset', {
      isCurrent: () => requestId === operation && revision === apiClient.getConnectionRevision(),
      setSaving: (saving) => events.push(`saving:${saving}`),
      setError: (error) => events.push(`error:${error}`),
      refresh: async () => {
        events.push('refresh');
      },
    });
  };
  return { events, start };
}

describe('routing status save lifecycle', () => {
  test('ignores a stale save AbortError after an ABA connection change', async () => {
    const first = { apiBase: 'https://first.invalid', managementKey: 'fixture' };
    apiClient.setConfig(first);
    const write = deferred<void>();
    spies.push(spyOn(routingApi, 'setStrategy').mockReturnValue(write.promise));
    const harness = saveHarness();

    const pending = harness.start();
    apiClient.setConfig({ apiBase: 'https://second.invalid', managementKey: 'other-fixture' });
    apiClient.setConfig(first);
    write.reject(new DOMException('The management connection changed.', 'AbortError'));
    await pending;

    expect(harness.events).toEqual(['saving:true', 'error:null']);
  });

  test('does not refresh or finish saving after a stale success', async () => {
    apiClient.setConfig({ apiBase: 'https://first.invalid', managementKey: 'fixture' });
    const write = deferred<void>();
    spies.push(spyOn(routingApi, 'setStrategy').mockReturnValue(write.promise));
    const harness = saveHarness();

    const pending = harness.start();
    apiClient.setConfig({ apiBase: 'https://second.invalid', managementKey: 'other-fixture' });
    write.resolve();
    await pending;

    expect(harness.events).toEqual(['saving:true', 'error:null']);
  });

  test('keeps only the newest save completion and refreshes after its write', async () => {
    const firstWrite = deferred<void>();
    const secondWrite = deferred<void>();
    const write = spyOn(routingApi, 'setStrategy')
      .mockImplementationOnce(() => firstWrite.promise)
      .mockImplementationOnce(() => secondWrite.promise);
    spies.push(write);
    const harness = saveHarness();

    const firstPending = harness.start();
    const secondPending = harness.start();
    secondWrite.resolve();
    await secondPending;
    firstWrite.reject(new Error('stale save failure'));
    await firstPending;

    expect(write).toHaveBeenCalledTimes(2);
    expect(harness.events).toEqual([
      'saving:true',
      'error:null',
      'saving:true',
      'error:null',
      'refresh',
      'saving:false',
    ]);
  });
});
