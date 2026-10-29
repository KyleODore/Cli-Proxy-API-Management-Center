import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores';
import type { UsageQueueBatch } from '@/services/api/usageQueue';
import {
  applyCacheSuccess,
  cacheHistoryStorageKey,
  compactCacheHistory,
  decodeCacheHistory,
  emptyCacheHistory,
  encodeCacheHistory,
} from './history';
import { buildCacheModel } from './model';
import type { CacheModel, CacheRange } from './types';
import { useCacheCollector } from './useCacheCollector';
import styles from './CachePage.module.scss';

const RANGES: CacheRange[] = ['24h', '7d', '17d'];
const numberFormat = new Intl.NumberFormat('en-US');

function readHistory(key: string, now = Date.now()) {
  try {
    return compactCacheHistory(decodeCacheHistory(localStorage.getItem(key) ?? ''), now);
  } catch {
    return emptyCacheHistory();
  }
}

function PartialBadge() {
  const { t } = useTranslation();
  return <span className={styles.partial}>{t('cache.partial')}</span>;
}

interface CachePageViewProps {
  model: CacheModel;
  range: CacheRange;
  onRangeChange: (range: CacheRange) => void;
  storageFailed: boolean;
  error: string | null;
}

export function CachePageView({
  model,
  range,
  onRangeChange,
  storageFailed,
  error,
}: CachePageViewProps) {
  const { t } = useTranslation();
  const maximum = Math.max(
    1,
    ...model.series.flatMap((point) => [point.cacheReadTokens ?? 0, point.cacheWriteTokens ?? 0])
  );
  const width = model.series.length ? 1000 / model.series.length : 1000;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>{t('cache.title')}</h1>
          <p>{t('cache.description')}</p>
        </div>
        <div className={styles.ranges} aria-label={t('cache.range')}>
          {RANGES.map((value) => (
            <button
              type="button"
              key={value}
              className={range === value ? styles.active : undefined}
              aria-pressed={range === value}
              onClick={() => onRangeChange(value)}
            >
              {t(`cache.range_${value}`)}
            </button>
          ))}
        </div>
      </header>

      <p className={styles.notice}>{t('cache.local_notice')}</p>
      {storageFailed ? <p className={styles.warning}>{t('cache.storage_failed')}</p> : null}
      {error ? <p className={styles.warning}>{error}</p> : null}

      <section className={styles.summary} aria-label={t('cache.totals')}>
        <div className={styles.metric}>
          <span>{t('cache.read_tokens')}</span>
          <strong>
            {numberFormat.format(model.totals.cacheReadTokens)}
            {model.totals.readPartial ? <PartialBadge /> : null}
          </strong>
        </div>
        <div className={styles.metric}>
          <span>{t('cache.write_tokens')}</span>
          <strong>
            {numberFormat.format(model.totals.cacheWriteTokens)}
            {model.totals.writePartial ? <PartialBadge /> : null}
          </strong>
        </div>
      </section>

      <section className={styles.timeline} aria-label={t('cache.history')}>
        <h2>{t('cache.history')}</h2>
        <svg viewBox="0 0 1000 150" role="img" aria-label={t('cache.history_chart')}>
          {model.series.map((point, index) => {
            const gap = point.cacheReadTokens === null || point.cacheWriteTokens === null;
            const height = gap
              ? 150
              : (Math.max(point.cacheReadTokens ?? 0, point.cacheWriteTokens ?? 0) / maximum) * 140;
            return (
              <rect
                key={point.at}
                x={index * width}
                y={150 - height}
                width={Math.max(0.5, width - 0.25)}
                height={height}
                fill={gap ? 'var(--border-color)' : 'var(--primary-color)'}
                opacity={gap ? 0.35 : 0.8}
                data-cache-point={gap ? 'gap' : 'covered'}
              >
                <title>
                  {gap
                    ? t('cache.no_coverage')
                    : `${t('cache.read_tokens')}: ${point.cacheReadTokens}; ${t(
                        'cache.write_tokens'
                      )}: ${point.cacheWriteTokens}`}
                </title>
              </rect>
            );
          })}
        </svg>
        <p className={styles.gapLegend}>{t('cache.gap_explanation')}</p>
      </section>

      <section aria-label={t('cache.by_credential_model')}>
        <h2 className={styles.tableTitle}>{t('cache.by_credential_model')}</h2>
        {model.rows.length ? (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>{t('cache.credential')}</th>
                  <th>{t('cache.provider')}</th>
                  <th>{t('cache.model')}</th>
                  <th>{t('cache.read_tokens')}</th>
                  <th>{t('cache.write_tokens')}</th>
                </tr>
              </thead>
              <tbody>
                {model.rows.map((row) => (
                  <tr key={`${row.authIndex}\0${row.provider}\0${row.model}`}>
                    <td>{row.authIndex === 'unknown' ? t('cache.unknown') : row.authIndex}</td>
                    <td>{row.provider === 'unknown' ? t('cache.unknown') : row.provider}</td>
                    <td>{row.model === 'unknown' ? t('cache.unknown') : row.model}</td>
                    <td>
                      {numberFormat.format(row.cacheReadTokens)}
                      {row.readPartial ? <PartialBadge /> : null}
                    </td>
                    <td>
                      {numberFormat.format(row.cacheWriteTokens)}
                      {row.writePartial ? <PartialBadge /> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.empty}>{t('cache.empty')}</p>
        )}
      </section>
    </div>
  );
}

export function CachePage() {
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const storageKey = useMemo(
    () => cacheHistoryStorageKey(apiBase, managementKey),
    [apiBase, managementKey]
  );
  const connectionKey = `${apiBase}\0${managementKey}`;
  const [state, setState] = useState(() => ({ key: storageKey, history: readHistory(storageKey) }));
  const [range, setRange] = useState<CacheRange>('24h');
  const [now, setNow] = useState(() => Date.now());
  const [storageFailed, setStorageFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setState({ key: storageKey, history: readHistory(storageKey) });
    setStorageFailed(false);
    setError(null);
  }, [storageKey]);

  useEffect(() => {
    if (state.key !== storageKey) return;
    try {
      localStorage.setItem(storageKey, encodeCacheHistory(state.history));
      setStorageFailed(false);
    } catch {
      setStorageFailed(true);
    }
  }, [state, storageKey]);

  const onSuccess = useCallback(
    (batch: UsageQueueBatch, at: number) => {
      setNow(at);
      setError(null);
      setState((previous) => {
        const history =
          previous.key === storageKey ? previous.history : readHistory(storageKey, at);
        return { key: storageKey, history: applyCacheSuccess(history, batch, at, at) };
      });
    },
    [storageKey]
  );
  const onError = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : String(cause));
  }, []);

  useCacheCollector({
    enabled: connectionStatus === 'connected',
    connectionKey,
    onSuccess,
    onError,
  });

  const history = state.key === storageKey ? state.history : emptyCacheHistory();
  const model = useMemo(() => buildCacheModel(history, now, range), [history, now, range]);
  return (
    <CachePageView
      model={model}
      range={range}
      onRangeChange={setRange}
      storageFailed={storageFailed}
      error={error}
    />
  );
}
