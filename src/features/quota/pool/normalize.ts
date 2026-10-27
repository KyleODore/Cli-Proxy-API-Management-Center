import type {
  ClaudeQuotaState,
  CodexQuotaState,
  DevinQuotaState,
  MetaQuotaState,
  KimiQuotaState,
  AntigravityQuotaState,
  XaiQuotaState,
} from '@/types';
import { readPassiveQuotaWindows } from '@/services/api/quotaSignals';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import type { QuotaFileEntry } from '../logic';
import type { QuotaCardState } from '../providers';
import { DAY, HOUR, clamp, type PoolAccount, type PoolWindow } from './model';

export function normalizeAccount(
  entry: QuotaFileEntry,
  quota: QuotaCardState | undefined,
  now: number
): PoolAccount | null {
  if (entry.file.disabled) return null;
  const plan = quota && 'planType' in quota ? quota.planType : entry.file.planType;
  // Weighting is a product convention, not a claim about token-equivalent limits.
  const capacity =
    entry.type === 'codex' && typeof plan === 'string' && /pro[ _-]?max/i.test(plan) ? 250 : 100;
  const windows: PoolWindow[] = [];
  const add = (
    id: string,
    remaining: number | null | undefined,
    reset: number | null | undefined,
    hours?: number | null
  ) => {
    if (typeof remaining !== 'number' || !Number.isFinite(remaining)) return;
    const resetAt = typeof reset === 'number' && Number.isFinite(reset) && reset > 0 ? reset : null;
    windows.push({
      id,
      remaining:
        resetAt !== null && resetAt <= now ? capacity : (clamp(remaining) * capacity) / 100,
      resetAt,
      durationMs: hours ? hours * HOUR : undefined,
      repeatMs: hours && hours * HOUR >= DAY ? hours * HOUR : undefined,
    });
  };
  if (
    quota &&
    (quota.status === 'success' || quota.status === 'loading') &&
    !('stale' in quota && quota.stale)
  ) {
    if (entry.type === 'claude' || entry.type === 'codex') {
      const source = quota as ClaudeQuotaState | CodexQuotaState;
      source.windows
        .filter((w) =>
          [
            'five-hour',
            'seven-day',
            'weekly',
            ...(entry.type === 'codex' ? ['monthly'] : []),
          ].includes(w.id)
        )
        .forEach((w) =>
          add(w.id, w.usedPercent == null ? null : 100 - w.usedPercent, w.resetAtMs, w.periodHours)
        );
    } else if (entry.type === 'devin') {
      (quota as DevinQuotaState).windows.forEach((w) =>
        add(w.id, w.remainingPercent, w.resetAtMs, w.periodHours)
      );
    } else if (entry.type === 'meta') {
      (quota as MetaQuotaState).data?.windows.forEach((w) =>
        add(
          w.id,
          w.usedPercent === null ? null : 100 - w.usedPercent,
          w.resetAt ? w.resetAt * 1000 : null,
          w.id === 'weekly' ? 168 : (w.durationMinutes ?? 0) / 60
        )
      );
    } else if (entry.type === 'kimi') {
      (quota as KimiQuotaState).rows.forEach((w) =>
        add(w.id, w.limit > 0 ? 100 * (1 - w.used / w.limit) : null, w.resetAtMs, w.periodHours)
      );
    } else if (entry.type === 'xai') {
      const billing = (quota as XaiQuotaState).billing;
      if (billing?.periodType === 'weekly')
        add(
          'weekly',
          billing.usagePercent === null ? null : 100 - billing.usagePercent,
          billing.resetAtMs,
          billing.periodHours ?? 168
        );
    } else {
      // Conservative all-model envelope. Per-model details stay available in Accounts.
      (quota as AntigravityQuotaState).groups
        .flatMap((g) => g.buckets)
        .forEach((w, i) =>
          add(
            `bucket-${i}`,
            w.remainingFraction == null ? null : w.remainingFraction * 100,
            w.resetAtMs,
            w.periodHours
          )
        );
    }
  }
  if (!windows.length) {
    readPassiveQuotaWindows(entry.file.quota, entry.type).forEach((w) =>
      add(w.id, 100 - w.usedPercent, w.resetAtMs, w.periodHours)
    );
  }
  const snapshot = entry.file.cooldownSnapshot;
  const credentialCooldowns = (snapshot?.records ?? []).filter(
    (record) => record.scope === 'credential'
  );
  const blockedUntil = Math.max(
    0,
    ...credentialCooldowns.map((record) => {
      const absolute = Date.parse(record.retryAt);
      return Number.isFinite(absolute)
        ? absolute
        : (snapshot?.receivedAtMs ?? now) + record.remainingSeconds * 1000;
    })
  );
  return {
    id: getQuotaCacheKey(entry.file),
    provider: entry.type,
    capacity,
    windows,
    blockedUntil: blockedUntil > now ? blockedUntil : undefined,
  };
}
