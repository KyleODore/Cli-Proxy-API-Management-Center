import { useConfigStore } from '@/stores';
import { apiClient } from './client';
import { guardConfigConnection } from './configValue';

export type ConfigurableRoutingStrategy =
  'round-robin' | 'weighted-round-robin' | 'fill-first' | 'soonest-reset';

export interface RoutingCredentialStatus {
  authIndex: string;
  rank: number | null;
  state: string;
  reason: string;
  priority: number | null;
  weeklyReset: string | null;
  exhaustedUntil: string | null;
  observedAt: string | null;
  probePending: boolean;
}

export interface RoutingStatus {
  strategy: string;
  generatedAt: string;
  sessionAffinity: { enabled: boolean | null; ttl: string | null };
  providers: Record<string, RoutingCredentialStatus[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalidPayload(): Error {
  return new Error('Invalid routing status response');
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function normalizeCredential(value: unknown): RoutingCredentialStatus {
  if (!isRecord(value) || !['string', 'number'].includes(typeof value.auth_index)) {
    throw invalidPayload();
  }
  if (typeof value.auth_index === 'number' && !Number.isFinite(value.auth_index)) {
    throw invalidPayload();
  }

  return {
    authIndex: String(value.auth_index),
    rank:
      typeof value.rank === 'number' && Number.isInteger(value.rank) && value.rank > 0
        ? value.rank
        : null,
    state: typeof value.state === 'string' ? value.state : '',
    reason: typeof value.reason === 'string' ? value.reason : '',
    priority:
      typeof value.priority === 'number' && Number.isFinite(value.priority) ? value.priority : null,
    weeklyReset: nullableString(value.weekly_reset),
    exhaustedUntil: nullableString(value.exhausted_until),
    observedAt: nullableString(value.observed_at),
    probePending: value.probe_pending === true,
  };
}

function normalizeStatus(value: unknown): RoutingStatus {
  if (
    !isRecord(value) ||
    typeof value.strategy !== 'string' ||
    typeof value.generated_at !== 'string' ||
    !isRecord(value.session_affinity) ||
    !isRecord(value.providers)
  ) {
    throw invalidPayload();
  }

  const providers: Record<string, RoutingCredentialStatus[]> = {};
  for (const [provider, credentials] of Object.entries(value.providers)) {
    if (!Array.isArray(credentials)) throw invalidPayload();
    providers[provider] = credentials.map(normalizeCredential);
  }

  return {
    strategy: value.strategy,
    generatedAt: value.generated_at,
    sessionAffinity: {
      enabled:
        typeof value.session_affinity.enabled === 'boolean' ? value.session_affinity.enabled : null,
      ttl: nullableString(value.session_affinity.ttl),
    },
    providers,
  };
}

export const routingApi = {
  async getStatus(): Promise<RoutingStatus> {
    return normalizeStatus(await apiClient.get('/routing/status'));
  },

  async setStrategy(strategy: ConfigurableRoutingStrategy): Promise<void> {
    const assertConnection = guardConfigConnection();
    await apiClient.put('/config/routing/strategy', strategy);
    assertConnection();
    useConfigStore.getState().updateConfigValue('routing/strategy', strategy);
  },
};
