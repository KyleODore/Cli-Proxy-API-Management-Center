import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient, routingApi } from '@/services/api';
import type { ConfigurableRoutingStrategy, RoutingStatus } from '@/services/api/routing';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useAuthStore } from '@/stores';

export function useRoutingStatus() {
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const [status, setStatus] = useState<RoutingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestRef.current;
    const revision = apiClient.getConnectionRevision();
    const isCurrent = () =>
      requestId === requestRef.current && revision === apiClient.getConnectionRevision();

    if (connectionStatus !== 'connected') {
      setStatus(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const next = await routingApi.getStatus();
      if (!isCurrent()) return;
      setStatus(next);
    } catch (cause: unknown) {
      if (!isCurrent()) return;
      setStatus(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [connectionStatus]);

  useHeaderRefresh(refresh);

  useEffect(() => {
    void refresh();
    if (connectionStatus !== 'connected') {
      return () => {
        requestRef.current += 1;
      };
    }

    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => {
      requestRef.current += 1;
      window.clearInterval(timer);
    };
  }, [connectionStatus, refresh]);

  const saveStrategy = useCallback(
    async (strategy: ConfigurableRoutingStrategy) => {
      setSaving(true);
      setError(null);
      try {
        await routingApi.setStrategy(strategy);
        await refresh();
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setSaving(false);
      }
    },
    [refresh]
  );

  return { status, loading, saving, error, refresh, setStrategy: saveStrategy };
}
