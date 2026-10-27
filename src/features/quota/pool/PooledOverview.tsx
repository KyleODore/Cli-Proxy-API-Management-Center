import { useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore, useThemeStore } from '@/stores';
import { getAuthFileIcon, getTypeLabel } from '@/features/authFiles/constants';
import type { QuotaFileEntry } from '../logic';
import type { QuotaCardState } from '../providers';
import { normalizeAccount } from './normalize';
import { aggregate, DAY, estimateBurn, project, type PoolAccount } from './model';
import { usePoolHistory } from './usePoolHistory';
import { ProjectionChart, type ChartMode } from './ProjectionChart';
import styles from './PooledOverview.module.scss';

const COLORS: Record<string, string> = {
  claude: '#e27d60',
  codex: '#78aafa',
  antigravity: '#10b981',
  xai: '#bdc7d7',
  kimi: '#a99bff',
  devin: '#f3b958',
  meta: '#38bdf8',
  plugin: '#ca93f7',
};
export function PooledOverview({
  entries,
  quotaFor,
  tab,
  now,
  observedAt,
  sampling,
  showAccounts,
  onToggleAccounts,
  autoRefresh,
  onToggleRefresh,
}: {
  entries: QuotaFileEntry[];
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined;
  tab: string;
  now: number;
  observedAt: number;
  sampling: boolean;
  showAccounts: boolean;
  onToggleAccounts: () => void;
  autoRefresh: boolean;
  onToggleRefresh: () => void;
}) {
  const { t, i18n } = useTranslation();
  const theme = useThemeStore((s) => s.resolvedTheme);
  const apiBase = useAuthStore((s) => s.apiBase);
  const managementKey = useAuthStore((s) => s.managementKey);
  const [mode, setMode] = useState<ChartMode>('remaining');
  const [interval, setInterval] = useState(3);
  const [multiplier, setMultiplier] = useState(1);
  const [offset, setOffset] = useState(0);
  const pools = useMemo(
    () =>
      aggregate(
        entries
          .map((entry) => normalizeAccount(entry, quotaFor(entry), now))
          .filter((a): a is PoolAccount => a !== null),
        now
      ),
    [entries, quotaFor, now]
  );
  const { histories, storageFailed } = usePoolHistory(
    pools,
    apiBase,
    managementKey,
    observedAt,
    sampling
  );
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - 3 + offset * 7);
  const start = from.getTime();
  const to = new Date(start);
  to.setDate(to.getDate() + 14);
  const end = to.getTime();
  const forecastEnd = Math.max(end, now + 14 * DAY);
  const shown = pools
    .filter((p) => tab === 'all' || p.provider === tab)
    .map((pool) => {
      const history = histories[pool.provider] ?? [];
      const burn = estimateBurn(history, now, interval, pool.signature);
      const projection = project(pool, now, forecastEnd, (burn ?? 0) * multiplier);
      const next = projection.points.find((p) => p.kind === 'reset' && p.at > now);
      return {
        pool,
        history,
        burn,
        projection:
          burn === null && multiplier !== 0
            ? { ...projection, points: projection.points.slice(0, 1) }
            : projection,
        next,
      };
    });
  const date = (at: number) =>
    new Date(at).toLocaleDateString(i18n.language, { month: 'short', day: 'numeric' });
  const time = (at: number) =>
    new Date(at).toLocaleString(i18n.language, {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
  const countdown = (at: number) => {
    const minutes = Math.max(0, Math.ceil((at - now) / 60_000));
    return t('prox.in_time', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
  };
  const totalCapacity = shown.reduce((sum, p) => sum + p.pool.capacity, 0);
  const available = shown.reduce((sum, p) => sum + p.pool.remaining, 0);
  const unknown = shown.reduce((sum, p) => sum + p.pool.unknown, 0);
  const nextResets = shown
    .flatMap(({ pool, projection }) =>
      projection.points
        .filter((p) => p.kind === 'reset' && p.at > now)
        .map((p) => ({ ...p, provider: pool.provider }))
    )
    .sort((a, b) => a.at - b.at);
  const forecastKnown =
    shown.length > 0 &&
    shown.every((p) => (p.burn !== null || multiplier === 0) && !p.pool.unknown);
  const burnsKnown = shown.length > 0 && shown.every((p) => p.burn !== null && !p.pool.unknown);
  const sumBurn = shown.reduce((sum, p) => sum + (p.burn ?? 0), 0);
  return (
    <div className={styles.overview}>
      <div className={styles.stats}>
        {[
          [
            t('prox.total_capacity'),
            `${totalCapacity}%`,
            t('prox.active_accounts', {
              count: pools
                .filter((p) => tab === 'all' || p.provider === tab)
                .reduce((n, p) => n + p.accounts.length, 0),
            }),
          ],
          [
            t('prox.available_now'),
            unknown ? '—' : `${Number(available.toFixed(1))}%`,
            unknown
              ? t('prox.missing', { count: unknown })
              : `${totalCapacity ? Math.round((available / totalCapacity) * 100) : 0}% ${t('prox.available')}`,
          ],
          [
            t('prox.combined_burn'),
            burnsKnown ? `${sumBurn.toFixed(1)}%/h` : '—',
            t('prox.last_hours', { hours: interval }),
          ],
          [
            t('prox.next_capacity_reset'),
            nextResets[0] && forecastKnown ? countdown(nextResets[0].at) : '—',
            nextResets[0] && forecastKnown ? time(nextResets[0].at) : t('prox.measuring'),
          ],
        ].map(([label, value, note]) => (
          <article className={styles.stat} key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{note}</small>
          </article>
        ))}
      </div>
      <div className={styles.toolbar}>
        <div className={styles.pills} aria-label={t('prox.chart_mode')}>
          {(['remaining', 'drain', 'burn'] as const).map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
            >
              {t(`prox.${value}`)}
            </button>
          ))}
        </div>
        <div className={styles.pills} aria-label={t('prox.burn_interval')}>
          {[1, 3, 6].map((hours) => (
            <button
              type="button"
              key={hours}
              aria-pressed={interval === hours}
              onClick={() => setInterval(hours)}
            >
              {hours}h
            </button>
          ))}
        </div>
        <label className={styles.usage}>
          {t('prox.future_usage')}{' '}
          <select value={multiplier} onChange={(e) => setMultiplier(Number(e.target.value))}>
            <option value={1}>{t('prox.same_now')}</option>
            <option value={0.5}>{t('prox.half_usage')}</option>
            <option value={1.5}>{t('prox.higher_usage')}</option>
            <option value={0}>{t('prox.no_usage')}</option>
          </select>
        </label>
        <button
          type="button"
          className={styles.control}
          aria-pressed={showAccounts}
          onClick={onToggleAccounts}
        >
          {t('prox.accounts')}
        </button>
        <button
          type="button"
          className={styles.control}
          aria-pressed={autoRefresh}
          onClick={onToggleRefresh}
        >
          {t('prox.auto_refresh')}
        </button>
        <div className={styles.dates}>
          <span>
            {date(start)} – {date(end - 1)}
          </span>
          <button
            type="button"
            className={styles.control}
            aria-label={t('prox.previous')}
            disabled={offset <= -2}
            onClick={() => setOffset(offset - 1)}
          >
            ‹
          </button>
          <button type="button" className={styles.control} onClick={() => setOffset(0)}>
            {t('prox.today')}
          </button>
          <button
            type="button"
            className={styles.control}
            aria-label={t('prox.next')}
            disabled={offset >= 2}
            onClick={() => setOffset(offset + 1)}
          >
            ›
          </button>
        </div>
      </div>
      {storageFailed && (
        <p role="status" className={styles.note}>
          {t('prox.storage_failed')}
        </p>
      )}
      {!showAccounts && (
        <div className={styles.layout}>
          <div className={styles.pools}>
            {shown.map(({ pool, history, burn, projection, next }) => {
              const complete = pool.unknown === 0;
              const measured = complete && (burn !== null || multiplier === 0);
              const label = getTypeLabel(t, pool.provider);
              const icon = getAuthFileIcon(pool.provider, theme);
              const color = COLORS[pool.provider] ?? COLORS.plugin;
              const empty = measured ? projection.emptyAt : null;
              return (
                <article
                  className={styles.poolCard}
                  key={pool.provider}
                  style={{ '--provider-color': color } as CSSProperties}
                >
                  <header className={styles.poolHeader}>
                    <div>
                      <div className={styles.provider}>
                        {icon && <img src={icon} alt="" />}
                        <h2>{label}</h2>
                        <span>{t('prox.account_count', { count: pool.accounts.length })}</span>
                      </div>
                      <div className={styles.capacity}>
                        <strong>{complete ? `${Number(pool.remaining.toFixed(1))}%` : '—'}</strong>
                        <span>{t('prox.of_capacity', { capacity: pool.capacity })}</span>
                        {pool.accounts.some((a) => a.capacity === 250) && (
                          <small>{t('prox.pro_max')}</small>
                        )}
                      </div>
                    </div>
                    <dl className={styles.kpis}>
                      <div>
                        <dt>{t('prox.pool_empty')}</dt>
                        <dd>
                          {!measured
                            ? t('prox.measuring')
                            : empty !== null && empty <= now + 14 * DAY
                              ? time(empty)
                              : t('prox.not_by', { date: date(now + 14 * DAY) })}
                        </dd>
                      </div>
                      <div>
                        <dt>{t('prox.first_empty')}</dt>
                        <dd>
                          {measured && projection.firstEmptyAt !== null
                            ? countdown(projection.firstEmptyAt)
                            : '—'}
                        </dd>
                      </div>
                      <div>
                        <dt>{t('prox.next_reset')}</dt>
                        <dd>
                          {next && measured
                            ? `+${Math.round(next.boost ?? 0)}% ${time(next.at)}`
                            : '—'}
                        </dd>
                      </div>
                      <div>
                        <dt>{t('prox.burn_last', { hours: interval })}</dt>
                        <dd>{burn === null ? '—' : `${burn.toFixed(1)}%/h`}</dd>
                      </div>
                    </dl>
                  </header>
                  {!complete ? (
                    <div className={styles.noData}>
                      {t('prox.missing', { count: pool.unknown })}
                    </div>
                  ) : (
                    <ProjectionChart
                      pool={pool}
                      projection={projection}
                      history={history}
                      now={now}
                      start={start}
                      end={end}
                      mode={mode}
                      burn={burn === null ? null : burn * multiplier}
                      color={color}
                    />
                  )}
                  {complete && !measured && (
                    <p className={styles.note}>{t('prox.measuring_help')}</p>
                  )}
                </article>
              );
            })}
            {!shown.length && <div className={styles.noData}>{t('prox.no_pool')}</div>}
            <details className={styles.assumptions}>
              <summary>{t('prox.model_details')}</summary>
              <p>{t('prox.assumptions')}</p>
              <p>{t('prox.burn_help')}</p>
            </details>
          </div>
          <aside className={styles.sidebar}>
            <section className={styles.widget}>
              <h2>{t('prox.on_horizon')}</h2>
              <p>{t('prox.scheduled_capacity')}</p>
              {nextResets.length && forecastKnown ? (
                nextResets.slice(0, 6).map((reset, i) => (
                  <div className={styles.resetRow} key={`${reset.provider}-${reset.at}-${i}`}>
                    <i style={{ background: COLORS[reset.provider] }} />
                    <div>
                      <strong>{getTypeLabel(t, reset.provider)}</strong>
                      <small>{time(reset.at)}</small>
                    </div>
                    <b style={{ color: COLORS[reset.provider] }}>
                      +{Math.round(reset.boost ?? 0)}%
                    </b>
                  </div>
                ))
              ) : (
                <p className={styles.note}>{t('prox.measuring_help')}</p>
              )}
            </section>
            <section className={styles.widget}>
              <h2>{t('prox.capacity_outlook')}</h2>
              <p>{t('prox.available_by_provider')}</p>
              {shown.map(({ pool }) => (
                <div className={styles.health} key={pool.provider}>
                  <div>
                    <span>{getTypeLabel(t, pool.provider)}</span>
                    <strong>
                      {pool.unknown
                        ? '—'
                        : `${Math.round((pool.remaining / pool.capacity) * 100)}%`}
                    </strong>
                  </div>
                  <div className={styles.track}>
                    <i
                      style={{
                        width: `${(pool.remaining / pool.capacity) * 100}%`,
                        background: COLORS[pool.provider],
                      }}
                    />
                  </div>
                  <small>
                    {pool.unknown
                      ? t('prox.missing', { count: pool.unknown })
                      : t('prox.of_capacity', { capacity: pool.capacity })}
                  </small>
                </div>
              ))}
            </section>
            <div className={styles.status}>
              <i />
              {autoRefresh ? t('prox.polling') : t('prox.paused')}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
