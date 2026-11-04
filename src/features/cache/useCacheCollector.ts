import { useEffect, useRef } from 'react';
import { popUsageQueue, type UsageQueueBatch } from '@/services/api/usageQueue';
import { apiClient as managementClient } from '@/services/api/client';

export const CACHE_POLL_MS = 5_000;
export const CACHE_POLL_COUNT = 100;

type Client = typeof managementClient;

interface CacheCollectorOptions {
  captureConnection?: () => Client;
  isCurrent?: () => boolean;
  pop?: (client: Client, count: number, signal: AbortSignal) => Promise<UsageQueueBatch>;
  now?: () => number;
  setTimer?: (callback: () => void, delay: number) => number;
  clearTimer?: (timer: number) => void;
  onSuccess: (batch: UsageQueueBatch, at: number) => void;
  onError: (error: unknown) => void;
}

export function createCacheCollector(options: CacheCollectorOptions) {
  const captureConnection =
    options.captureConnection ?? (() => managementClient.captureConnection());
  const isCurrent = options.isCurrent ?? (() => true);
  const pop = options.pop ?? popUsageQueue;
  const now = options.now ?? Date.now;
  const setTimer =
    options.setTimer ??
    ((callback: () => void, delay: number) => window.setInterval(callback, delay));
  const clearTimer = options.clearTimer ?? ((timer: number) => window.clearInterval(timer));

  let active = false;
  let inFlight: Promise<void> | null = null;
  let controller: AbortController | null = null;
  let timer: number | null = null;

  const poll = (): Promise<void> => {
    if (!active) return Promise.resolve();
    if (inFlight) return inFlight;
    const requestController = new AbortController();
    controller = requestController;
    const client = captureConnection();
    const operation = (async () => {
      try {
        const batch = await pop(client, CACHE_POLL_COUNT, requestController.signal);
        if (active && isCurrent() && !requestController.signal.aborted) {
          options.onSuccess(batch, now());
        }
      } catch (error: unknown) {
        const aborted =
          requestController.signal.aborted ||
          (typeof error === 'object' &&
            error !== null &&
            'name' in error &&
            error.name === 'AbortError');
        if (active && isCurrent() && !aborted) options.onError(error);
      } finally {
        if (controller === requestController) {
          inFlight = null;
          controller = null;
        }
      }
    })();
    inFlight = operation;
    return operation;
  };

  const stop = () => {
    if (!active) return;
    active = false;
    if (timer !== null) clearTimer(timer);
    timer = null;
    controller?.abort();
  };

  const start = () => {
    if (active) return stop;
    active = true;
    timer = setTimer(() => void poll(), CACHE_POLL_MS);
    void poll();
    return stop;
  };

  return { start, stop, poll };
}

interface UseCacheCollectorOptions {
  enabled: boolean;
  connectionKey: string;
  onSuccess: (batch: UsageQueueBatch, at: number) => void;
  onError: (error: unknown) => void;
}

export function useCacheCollector({
  enabled,
  connectionKey,
  onSuccess,
  onError,
}: UseCacheCollectorOptions) {
  const callbacks = useRef({ onSuccess, onError });
  useEffect(() => {
    callbacks.current = { onSuccess, onError };
  });

  useEffect(() => {
    if (!enabled) return;
    const revision = managementClient.getConnectionRevision();
    const collector = createCacheCollector({
      captureConnection: () => managementClient.captureConnection(),
      isCurrent: () => revision === managementClient.getConnectionRevision(),
      onSuccess: (batch, at) => callbacks.current.onSuccess(batch, at),
      onError: (error) => callbacks.current.onError(error),
    });
    return collector.start();
  }, [enabled, connectionKey]);
}
