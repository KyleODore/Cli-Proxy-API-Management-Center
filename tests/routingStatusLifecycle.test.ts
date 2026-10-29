/* eslint-disable react-hooks/immutability -- Direct dispatcher harness for production-hook lifecycle tests. */
import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import React from 'react';
import { getSoonestResetCapability, useRoutingStatus } from '@/features/routing/useRoutingStatus';
import { apiClient } from '@/services/api/client';
import { routingApi } from '@/services/api/routing';
import type { RoutingStatus } from '@/services/api/routing';
import { useAuthStore } from '@/stores';

interface StateSlot {
  current: unknown;
  updates: unknown[];
}

interface HookDispatcher {
  useCallback: (callback: unknown) => unknown;
  useDebugValue: () => void;
  useEffect: () => void;
  useLayoutEffect: () => void;
  useMemo: (factory: () => unknown) => unknown;
  useRef: (current: unknown) => { current: unknown };
  useState: (initial: unknown) => [unknown, (next: unknown) => void];
  useSyncExternalStore: (
    subscribe: (callback: () => void) => () => void,
    getSnapshot: () => unknown
  ) => unknown;
}

const reactInternals = (
  React as unknown as {
    __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: { H: unknown };
  }
).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
const initialConnectionStatus = useAuthStore.getState().connectionStatus;
const spies: Array<{ mockRestore(): void }> = [];

afterEach(() => {
  spies.splice(0).forEach((spy) => spy.mockRestore());
  apiClient.setConfig({ apiBase: '', managementKey: '' });
  useAuthStore.getState().connectionStatus = initialConnectionStatus;
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

function useProductionHookHarness() {
  const states: StateSlot[] = [];
  const previousDispatcher = reactInternals.H;
  const dispatcher: HookDispatcher = {
    useCallback: (callback) => callback,
    useDebugValue: () => {},
    useEffect: () => {},
    useLayoutEffect: () => {},
    useMemo: (factory) => factory(),
    useRef: (current) => ({ current }),
    useState: (initial) => {
      const slot: StateSlot = { current: initial, updates: [] };
      states.push(slot);
      return [
        initial,
        (next) => {
          const value =
            typeof next === 'function'
              ? (next as (previous: unknown) => unknown)(slot.current)
              : next;
          slot.current = value;
          slot.updates.push(value);
        },
      ];
    },
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  };

  useAuthStore.getState().connectionStatus = 'connected';
  reactInternals.H = dispatcher;
  try {
    return { routing: useRoutingStatus(), states };
  } finally {
    reactInternals.H = previousDispatcher;
  }
}

describe('routing status save lifecycle', () => {
  test('ignores a stale save AbortError after an ABA connection change', async () => {
    const first = { apiBase: 'https://first.invalid', managementKey: 'fixture' };
    apiClient.setConfig(first);
    const write = deferred<void>();
    spies.push(spyOn(routingApi, 'setStrategy').mockReturnValue(write.promise));
    const { routing, states } = useProductionHookHarness();

    const pending = routing.setStrategy('soonest-reset');
    apiClient.setConfig({ apiBase: 'https://second.invalid', managementKey: 'other-fixture' });
    apiClient.setConfig(first);
    write.reject(new DOMException('The management connection changed.', 'AbortError'));
    await pending;

    expect(states[3].updates).toEqual([null]);
    expect(states[2].updates).toEqual([true]);
  });

  test('does not refresh or finish saving after a stale success', async () => {
    apiClient.setConfig({ apiBase: 'https://first.invalid', managementKey: 'fixture' });
    const write = deferred<void>();
    const getStatus = spyOn(routingApi, 'getStatus');
    spies.push(spyOn(routingApi, 'setStrategy').mockReturnValue(write.promise), getStatus);
    const { routing, states } = useProductionHookHarness();

    const pending = routing.setStrategy('soonest-reset');
    apiClient.setConfig({ apiBase: 'https://second.invalid', managementKey: 'other-fixture' });
    write.resolve();
    await pending;

    expect(getStatus).not.toHaveBeenCalled();
    expect(states[2].updates).toEqual([true]);
    expect(states[3].updates).toEqual([null]);
  });

  test('keeps only the newest save completion and refreshes after its write', async () => {
    const firstWrite = deferred<void>();
    const secondWrite = deferred<void>();
    const write = spyOn(routingApi, 'setStrategy')
      .mockImplementationOnce(() => firstWrite.promise)
      .mockImplementationOnce(() => secondWrite.promise);
    const getStatus = spyOn(routingApi, 'getStatus').mockResolvedValue({} as RoutingStatus);
    spies.push(write, getStatus);
    const { routing, states } = useProductionHookHarness();

    const firstPending = routing.setStrategy('soonest-reset');
    const secondPending = routing.setStrategy('fill-first');
    secondWrite.resolve();
    await secondPending;
    firstWrite.reject(new Error('stale save failure'));
    await firstPending;

    expect(write).toHaveBeenCalledTimes(2);
    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(states[2].updates).toEqual([true, true, false]);
    expect(states[3].updates).toEqual([null, null, null]);
  });

  test('keeps a pending save authoritative across a same-connection refresh', async () => {
    apiClient.setConfig({ apiBase: 'https://first.invalid', managementKey: 'fixture' });
    const write = deferred<void>();
    const setStrategy = spyOn(routingApi, 'setStrategy').mockReturnValue(write.promise);
    const getStatus = spyOn(routingApi, 'getStatus').mockResolvedValue({} as RoutingStatus);
    spies.push(setStrategy, getStatus);
    const { routing, states } = useProductionHookHarness();

    const pendingSave = routing.setStrategy('soonest-reset');
    await routing.refresh();
    const savingDuringWrite = states[2].current;
    const earlySave = states[2].current ? null : routing.setStrategy('fill-first');
    const writesDuringPending = setStrategy.mock.calls.length;
    write.resolve();
    await Promise.all([pendingSave, earlySave].filter(Boolean));

    expect(savingDuringWrite).toBe(true);
    expect(writesDuringPending).toBe(1);
    expect(getStatus).toHaveBeenCalledTimes(2);
    expect(states[2].current).toBe(false);
  });

  test('shares successful status capability only for the confirmed connection', async () => {
    const first = { apiBase: 'https://first.invalid', managementKey: 'fixture' };
    apiClient.setConfig(first);
    const getStatus = spyOn(routingApi, 'getStatus')
      .mockRejectedValueOnce({ status: 404 })
      .mockResolvedValue({} as RoutingStatus);
    spies.push(getStatus);
    const { routing } = useProductionHookHarness();

    expect(getSoonestResetCapability()).toBe(false);
    await routing.refresh();
    expect(getSoonestResetCapability()).toBe(false);
    await routing.refresh();
    expect(getSoonestResetCapability()).toBe(true);
    apiClient.setConfig({ apiBase: 'https://second.invalid', managementKey: 'other-fixture' });
    expect(getSoonestResetCapability()).toBe(false);
  });

  for (const statusCode of [404, 501]) {
    test(`revokes confirmed capability after a current ${statusCode} response`, async () => {
      apiClient.setConfig({ apiBase: 'https://first.invalid', managementKey: 'fixture' });
      const getStatus = spyOn(routingApi, 'getStatus').mockResolvedValueOnce({} as RoutingStatus);
      spies.push(getStatus);
      const { routing } = useProductionHookHarness();

      await routing.refresh();
      expect(getSoonestResetCapability()).toBe(true);
      getStatus.mockRejectedValueOnce(
        Object.assign(new Error('unsupported'), { status: statusCode })
      );
      await routing.refresh();

      expect(getSoonestResetCapability()).toBe(false);
    });
  }

  test('retains confirmed capability after a transient error while clearing status', async () => {
    apiClient.setConfig({ apiBase: 'https://first.invalid', managementKey: 'fixture' });
    const getStatus = spyOn(routingApi, 'getStatus').mockResolvedValueOnce({} as RoutingStatus);
    spies.push(getStatus);
    const { routing, states } = useProductionHookHarness();

    await routing.refresh();
    getStatus.mockRejectedValueOnce(new Error('temporary failure'));
    await routing.refresh();

    expect(getSoonestResetCapability()).toBe(true);
    expect(states[0].current).toBeNull();
    expect(states[3].current).toBe('temporary failure');
  });

  test('does not revoke current capability for a stale unsupported response', async () => {
    apiClient.setConfig({ apiBase: 'https://first.invalid', managementKey: 'fixture' });
    const staleResponse = deferred<void>();
    const getStatus = spyOn(routingApi, 'getStatus')
      .mockImplementationOnce(() => staleResponse.promise)
      .mockResolvedValueOnce({} as RoutingStatus);
    spies.push(getStatus);
    const { routing } = useProductionHookHarness();

    const staleRefresh = routing.refresh();
    await routing.refresh();
    expect(getSoonestResetCapability()).toBe(true);
    staleResponse.reject(Object.assign(new Error('stale unsupported'), { status: 404 }));
    await staleRefresh;

    expect(getSoonestResetCapability()).toBe(true);
  });
});
