import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { apiClient } from '@/services/api/client';
import { routingApi } from '@/services/api/routing';
import { useConfigStore } from '@/stores';

const spies: Array<{ mockRestore(): void }> = [];
const mock = (method: 'get' | 'put', value: unknown = {}) => {
  const spy = spyOn(apiClient, method).mockResolvedValue(value as never);
  spies.push(spy);
  return spy;
};

afterEach(() => {
  spies.splice(0).forEach((spy) => spy.mockRestore());
  apiClient.setConfig({ apiBase: '', managementKey: '' });
});

const validPayload = {
  strategy: 'soonest-reset',
  generated_at: '2026-10-28T12:00:00Z',
  session_affinity: { enabled: true, ttl: '1h0m0s' },
  providers: {
    claude: [
      {
        auth_index: 7,
        rank: 1,
        state: 'eligible',
        reason: 'known',
        priority: 10,
        weekly_reset: '2026-11-04T00:00:00Z',
        exhausted_until: null,
        observed_at: '2026-10-28T11:59:00Z',
        probe_pending: true,
      },
      {
        auth_index: '8',
        rank: 0,
        state: 'disabled',
        reason: 'disabled',
        priority: 0,
        probe_pending: false,
      },
    ],
    codex: [],
  },
};

describe('routing status API', () => {
  test('reads the exact v8 route and normalizes without reordering or ranking', async () => {
    const get = mock('get', validPayload);

    expect(await routingApi.getStatus()).toEqual({
      strategy: 'soonest-reset',
      generatedAt: '2026-10-28T12:00:00Z',
      sessionAffinity: { enabled: true, ttl: '1h0m0s' },
      providers: {
        claude: [
          {
            authIndex: '7',
            rank: 1,
            state: 'eligible',
            reason: 'known',
            priority: 10,
            weeklyReset: '2026-11-04T00:00:00Z',
            exhaustedUntil: null,
            observedAt: '2026-10-28T11:59:00Z',
            probePending: true,
          },
          {
            authIndex: '8',
            rank: null,
            state: 'disabled',
            reason: 'disabled',
            priority: 0,
            weeklyReset: null,
            exhaustedUntil: null,
            observedAt: null,
            probePending: false,
          },
        ],
        codex: [],
      },
    });
    expect(get).toHaveBeenCalledWith('/routing/status');
  });

  test('rejects malformed top-level and account payloads', async () => {
    const get = mock('get');
    const malformed = [
      null,
      [],
      { ...validPayload, providers: null },
      { ...validPayload, session_affinity: null },
      { ...validPayload, providers: { claude: {} } },
      { ...validPayload, providers: { claude: [{ auth_index: {} }] } },
    ];

    for (const payload of malformed) {
      get.mockResolvedValueOnce(payload);
      await expect(routingApi.getStatus()).rejects.toThrow('Invalid routing status response');
    }
  });

  test('writes a bare scalar and updates the v8 config cache', async () => {
    const put = mock('put');
    const update = spyOn(useConfigStore.getState(), 'updateConfigValue').mockImplementation(
      () => {}
    );
    spies.push(update);

    await routingApi.setStrategy('soonest-reset');

    expect(put).toHaveBeenCalledWith('/config/routing/strategy', 'soonest-reset');
    expect(update).toHaveBeenCalledWith('routing/strategy', 'soonest-reset');
  });

  test('aborts the cache write after an ABA connection change', async () => {
    const first = { apiBase: 'https://first.invalid', managementKey: 'fixture' };
    apiClient.setConfig(first);
    const put = mock('put').mockImplementation(async () => {
      apiClient.setConfig({ apiBase: 'https://second.invalid', managementKey: 'other-fixture' });
      apiClient.setConfig(first);
      return {};
    });
    const update = spyOn(useConfigStore.getState(), 'updateConfigValue').mockImplementation(
      () => {}
    );
    spies.push(update);

    await expect(routingApi.setStrategy('fill-first')).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(put).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });
});
