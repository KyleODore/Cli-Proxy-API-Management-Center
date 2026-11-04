import { RoutingStatusView } from './RoutingStatusView';
import { useRoutingStatus } from './useRoutingStatus';

export function RoutingPage() {
  const { status, loading, saving, error, refresh, setStrategy } = useRoutingStatus();

  return (
    <RoutingStatusView
      status={status}
      loading={loading}
      saving={saving}
      error={error}
      onRefresh={() => void refresh()}
      onStrategyChange={(strategy) => void setStrategy(strategy)}
    />
  );
}
