import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { RoutingStatusView } from '@/features/routing/RoutingStatusView';
import type { RoutingStatus } from '@/services/api/routing';

const translations = i18n.cloneInstance({ lng: 'en' });
const noop = () => {};
const status: RoutingStatus = {
  strategy: 'soonest-reset',
  generatedAt: '2026-10-28T12:00:00Z',
  sessionAffinity: { enabled: true, ttl: '1h0m0s' },
  providers: {
    claude: [
      {
        authIndex: 'higher-priority-later-reset',
        rank: 1,
        state: 'eligible',
        reason: 'known',
        priority: 20,
        weeklyReset: '2026-11-04T00:00:00Z',
        exhaustedUntil: null,
        observedAt: '2026-10-28T11:59:00Z',
        probePending: false,
      },
      {
        authIndex: 'lower-priority-sooner-reset',
        rank: 2,
        state: 'exhausted',
        reason: 'known',
        priority: 1,
        weeklyReset: '2026-10-30T00:00:00Z',
        exhaustedUntil: '2026-10-29T00:00:00Z',
        observedAt: null,
        probePending: false,
      },
      {
        authIndex: 'unknown-probe',
        rank: 3,
        state: 'eligible',
        reason: 'probe',
        priority: null,
        weeklyReset: null,
        exhaustedUntil: null,
        observedAt: null,
        probePending: true,
      },
    ],
  },
};

function render(error: string | null = null, current: RoutingStatus | null = status) {
  return renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n: translations },
      createElement(RoutingStatusView, {
        status: current,
        loading: false,
        saving: false,
        error,
        onRefresh: noop,
        onStrategyChange: noop,
      })
    )
  );
}

describe('authoritative routing status view', () => {
  test('renders backend order, rank, timestamps, affinity, and diagnostic badges', () => {
    const markup = render();

    expect(markup).toContain('<table');
    expect(markup).toContain('<option value="soonest-reset"');
    expect(markup.indexOf('higher-priority-later-reset')).toBeLessThan(
      markup.indexOf('lower-priority-sooner-reset')
    );
    expect(markup).toContain('2026-11-04T00:00:00Z');
    expect(markup).toContain('2026-10-29T00:00:00Z');
    expect(markup).toContain('1h0m0s');
    expect(markup).toContain('Probe pending');
    expect(markup).toContain('Reset unknown');
    expect(markup).toContain('exhausted');
    expect(markup).toContain('Higher priority accounts sort first');
  });

  test('error and unsupported states expose neither a table nor a soonest-reset option', () => {
    for (const current of [status, null]) {
      const markup = render('Routing status is unsupported by this backend.', current);
      expect(markup).toContain('Routing status is unsupported by this backend.');
      expect(markup).not.toContain('<table');
      expect(markup).not.toContain('<option value="soonest-reset"');
    }
  });

  test('the hook owns guarded mount, global, and 30-second refreshes', () => {
    const source = readFileSync(
      new URL('../src/features/routing/useRoutingStatus.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain('apiClient.getConnectionRevision()');
    expect(source).toMatch(/requestId\s*===\s*requestRef\.current/);
    expect(source).toContain('useHeaderRefresh(refresh)');
    expect(source).toContain('30_000');
    expect(source).toContain('routingApi.setStrategy');
  });
});
