import { useEffect, useMemo, useState } from 'react';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { compactHistory, type Pool } from './model';

import { decodeHistories, encodeHistories, type Histories } from './historyCodec';
function read(key: string): Histories {
  try {
    const histories = decodeHistories(localStorage.getItem(key) ?? '{}');
    return Object.fromEntries(
      Object.entries(histories).map(([provider, rows]) => [
        provider,
        compactHistory(rows, Date.now()),
      ])
    );
  } catch {
    return {};
  }
}
export function usePoolHistory(
  pools: Pool[],
  apiBase: string,
  managementKey: string,
  now: number,
  sampling: boolean
) {
  // Hash scopes history to a server and principal. Management keys and raw quota payloads are never written to history.
  const storageKey = useMemo(
    () =>
      `prox.history.v1.${bytesToHex(sha256(new TextEncoder().encode(`${apiBase}\0${managementKey}`)))}`,
    [apiBase, managementKey]
  );
  const [state, setState] = useState<{ key: string; histories: Histories }>(() => ({
    key: storageKey,
    histories: read(storageKey),
  }));
  const [storageFailed, setStorageFailed] = useState(false);
  useEffect(() => {
    if (!sampling) return;
    setState((previous) => {
      const histories = {
        ...(previous.key === storageKey ? previous.histories : read(storageKey)),
      };
      for (const pool of pools) {
        if (pool.unknown || !pool.accounts.length) continue;
        const rows = histories[pool.provider] ?? [];
        const last = rows[rows.length - 1];
        if (last && now - last.at < 30_000) continue;
        const resetAt = Math.min(
          ...pool.accounts.flatMap((a) => [
            a.blockedUntil ?? Infinity,
            ...a.windows.map((w) => (w.resetAt && w.resetAt > now ? w.resetAt : Infinity)),
          ])
        );
        histories[pool.provider] = compactHistory(
          [
            ...rows,
            {
              at: now,
              remaining: pool.remaining,
              capacity: pool.capacity,
              signature: pool.signature,
              resetAt: Number.isFinite(resetAt) ? resetAt : undefined,
            },
          ],
          now
        );
      }
      return { key: storageKey, histories };
    });
  }, [now, pools, sampling, storageKey]);
  useEffect(() => {
    if (state.key !== storageKey) return;
    try {
      localStorage.setItem(storageKey, encodeHistories(state.histories));
      setStorageFailed(false);
    } catch {
      setStorageFailed(true);
    }
  }, [state, storageKey]);
  return { histories: state.key === storageKey ? state.histories : {}, storageFailed };
}
