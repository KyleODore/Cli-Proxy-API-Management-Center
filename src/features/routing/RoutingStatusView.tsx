import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconRefreshCw } from '@/components/ui/icons';
import type { ConfigurableRoutingStrategy, RoutingStatus } from '@/services/api/routing';
import styles from './RoutingPage.module.scss';

const STRATEGIES: ConfigurableRoutingStrategy[] = [
  'round-robin',
  'weighted-round-robin',
  'fill-first',
  'soonest-reset',
];

interface RoutingStatusViewProps {
  status: RoutingStatus | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  onRefresh: () => void;
  onStrategyChange: (strategy: ConfigurableRoutingStrategy) => void;
}

function timestamp(value: string | null) {
  return value ? <time dateTime={value}>{value}</time> : '—';
}

export function RoutingStatusView({
  status,
  loading,
  saving,
  error,
  onRefresh,
  onStrategyChange,
}: RoutingStatusViewProps) {
  const { t } = useTranslation();
  const providers = status && !error ? Object.entries(status.providers) : [];
  const strategy =
    status && STRATEGIES.includes(status.strategy as ConfigurableRoutingStrategy)
      ? (status.strategy as ConfigurableRoutingStrategy)
      : '';

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>{t('routing.title')}</h1>
          <p>{t('routing.description')}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={onRefresh} disabled={loading || saving}>
          <IconRefreshCw size={14} />
          {t('routing.refresh')}
        </Button>
      </header>

      {error ? (
        <div className={styles.error} role="alert">
          {error}
        </div>
      ) : null}

      {status && !error ? (
        <>
          <section className={styles.summary} aria-label={t('routing.summary')}>
            <div className={styles.strategyField}>
              <label htmlFor="routing-strategy">{t('routing.strategy')}</label>
              <select
                id="routing-strategy"
                value={strategy}
                disabled={saving || loading}
                onChange={(event) =>
                  onStrategyChange(event.target.value as ConfigurableRoutingStrategy)
                }
              >
                {strategy === '' ? <option value="">{status.strategy || '—'}</option> : null}
                {STRATEGIES.map((value) => (
                  <option key={value} value={value}>
                    {t(`routing.strategy_${value.replace(/-/g, '_')}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.summaryItem}>
              <span>{t('routing.generated_at')}</span>
              <strong>{timestamp(status.generatedAt)}</strong>
            </div>
            <div className={styles.summaryItem}>
              <span>{t('routing.session_affinity')}</span>
              <strong>
                {status.sessionAffinity.enabled === null
                  ? t('routing.unknown')
                  : status.sessionAffinity.enabled
                    ? t('routing.affinity_enabled')
                    : t('routing.affinity_disabled')}
                {' · '}
                {status.sessionAffinity.ttl ?? '—'}
              </strong>
            </div>
          </section>

          <p className={styles.explanation}>{t('routing.priority_explanation')}</p>

          {providers.length === 0 ? (
            <EmptyState
              title={t('routing.empty_title')}
              description={t('routing.empty_description')}
            />
          ) : (
            providers.map(([provider, credentials]) => (
              <section className={styles.provider} key={provider}>
                <h2>{provider}</h2>
                <div className={styles.tableWrap}>
                  <table>
                    <thead>
                      <tr>
                        <th>{t('routing.auth_index')}</th>
                        <th>{t('routing.rank')}</th>
                        <th>{t('routing.state')}</th>
                        <th>{t('routing.reason')}</th>
                        <th>{t('routing.priority')}</th>
                        <th>{t('routing.weekly_reset')}</th>
                        <th>{t('routing.exhausted_until')}</th>
                        <th>{t('routing.observed_at')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {credentials.map((credential) => (
                        <tr key={credential.authIndex}>
                          <td>
                            <span className={styles.authIndex}>{credential.authIndex}</span>
                            {credential.probePending ? (
                              <span className={styles.badge}>{t('routing.probe_pending')}</span>
                            ) : null}
                          </td>
                          <td>{credential.rank ?? '—'}</td>
                          <td>
                            <span className={styles.state} data-state={credential.state}>
                              {credential.state || t('routing.unknown')}
                            </span>
                          </td>
                          <td>{credential.reason || '—'}</td>
                          <td>{credential.priority ?? '—'}</td>
                          <td>
                            {timestamp(credential.weeklyReset)}
                            {credential.weeklyReset === null ? (
                              <span className={styles.badge}>{t('routing.reset_unknown')}</span>
                            ) : null}
                          </td>
                          <td>{timestamp(credential.exhaustedUntil)}</td>
                          <td>{timestamp(credential.observedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))
          )}
        </>
      ) : loading ? (
        <p className={styles.loading}>{t('routing.loading')}</p>
      ) : null}
    </div>
  );
}
