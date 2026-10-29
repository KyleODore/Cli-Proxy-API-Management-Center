import { describe, expect, test } from 'bun:test';
import { readPassiveQuotaWindows } from '@/services/api/quotaSignals';

const casings = ['canonical', 'lowercase'] as const;

describe('passive Claude quota signals', () => {
  const canonical = {
    fiveHourUtilization: 'Anthropic-Ratelimit-Unified-5h-Utilization',
    fiveHourReset: 'Anthropic-Ratelimit-Unified-5h-Reset',
    sevenDayUtilization: 'Anthropic-Ratelimit-Unified-7d-Utilization',
    sevenDayReset: 'Anthropic-Ratelimit-Unified-7d-Reset',
  };

  test.each(casings)('reads %s HTTP header names', (casing) => {
    const key = (name: string) => (casing === 'lowercase' ? name.toLowerCase() : name);
    const windows = readPassiveQuotaWindows(
      {
        signals: {
          [key(canonical.fiveHourUtilization)]: 0.25,
          [key(canonical.fiveHourReset)]: 1_800_000_000,
          [key(canonical.sevenDayUtilization)]: 0.25,
          [key(canonical.sevenDayReset)]: 1_800_000_000,
        },
      },
      'claude'
    );

    expect(windows).toEqual([
      {
        id: 'five-hour',
        usedPercent: 25,
        resetAtMs: 1_800_000_000_000,
        periodHours: 5,
      },
      {
        id: 'seven-day',
        usedPercent: 25,
        resetAtMs: 1_800_000_000_000,
        periodHours: 168,
      },
    ]);
  });

  test('returns a null reset time when a lowercase reset signal is missing', () => {
    const windows = readPassiveQuotaWindows(
      {
        signals: {
          'anthropic-ratelimit-unified-5h-utilization': 0.25,
          'anthropic-ratelimit-unified-7d-utilization': 0.25,
        },
      },
      'claude'
    );

    expect(windows.map((window) => window.resetAtMs)).toEqual([null, null]);
  });
});

describe('passive Codex quota signals', () => {
  const canonical = {
    primaryUsedPercent: 'X-Codex-Primary-Used-Percent',
    primaryResetAt: 'X-Codex-Primary-Reset-At',
    secondaryUsedPercent: 'X-Codex-Secondary-Used-Percent',
    secondaryResetAt: 'X-Codex-Secondary-Reset-At',
  };

  test.each(casings)('reads %s HTTP header names', (casing) => {
    const key = (name: string) => (casing === 'lowercase' ? name.toLowerCase() : name);
    const windows = readPassiveQuotaWindows(
      {
        signals: {
          [key(canonical.primaryUsedPercent)]: 25,
          [key(canonical.primaryResetAt)]: 1_800_000_000,
          [key(canonical.secondaryUsedPercent)]: 25,
          [key(canonical.secondaryResetAt)]: 1_800_000_000,
        },
      },
      'codex'
    );

    expect(windows).toEqual([
      {
        id: 'five-hour',
        usedPercent: 25,
        resetAtMs: 1_800_000_000_000,
        periodHours: 5,
      },
      {
        id: 'weekly',
        usedPercent: 25,
        resetAtMs: 1_800_000_000_000,
        periodHours: 168,
      },
    ]);
  });

  test('returns a null reset time when a lowercase reset signal is missing', () => {
    const windows = readPassiveQuotaWindows(
      {
        signals: {
          'x-codex-primary-used-percent': 25,
          'x-codex-secondary-used-percent': 25,
        },
      },
      'codex'
    );

    expect(windows.map((window) => window.resetAtMs)).toEqual([null, null]);
  });
});

test('returns no passive quota windows when signals are missing', () => {
  expect(readPassiveQuotaWindows({}, 'claude')).toEqual([]);
  expect(readPassiveQuotaWindows({}, 'codex')).toEqual([]);
});
