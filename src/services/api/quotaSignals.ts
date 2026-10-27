/** Optional passive quota headers supplied by compatible credential scanners. */
export interface PassiveQuotaWindow {
  id: string;
  usedPercent: number;
  resetAtMs: number | null;
  periodHours: number;
}
export function readPassiveQuotaWindows(quota: unknown, provider: string): PassiveQuotaWindow[] {
  if (!quota || typeof quota !== 'object' || !('signals' in quota)) return [];
  const signals = quota.signals;
  if (!signals || typeof signals !== 'object') return [];
  const fields = signals as Record<string, unknown>;
  const num = (key: string): number | null => {
    const value = fields[key];
    if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const definitions: [string, string, string, number, number][] =
    provider === 'claude'
      ? [
          [
            'five-hour',
            'anthropic-ratelimit-unified-5h-utilization',
            'anthropic-ratelimit-unified-5h-reset',
            5,
            100,
          ],
          [
            'seven-day',
            'anthropic-ratelimit-unified-7d-utilization',
            'anthropic-ratelimit-unified-7d-reset',
            168,
            100,
          ],
        ]
      : provider === 'codex'
        ? [
            ['five-hour', 'x-codex-primary-used-percent', 'x-codex-primary-reset-at', 5, 1],
            ['weekly', 'x-codex-secondary-used-percent', 'x-codex-secondary-reset-at', 168, 1],
          ]
        : [];
  return definitions.flatMap(([id, used, reset, periodHours, scale]) => {
    const value = num(used);
    const epoch = num(reset);
    return value === null
      ? []
      : [
          {
            id,
            usedPercent: value * scale,
            resetAtMs: epoch && epoch > 0 ? epoch * 1000 : null,
            periodHours,
          },
        ];
  });
}
