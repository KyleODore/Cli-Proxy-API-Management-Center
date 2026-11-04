import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { CachePageView } from '@/features/cache/CachePage';
import type { CacheModel } from '@/features/cache/types';

const translations = i18n.cloneInstance({ lng: 'en' });
const noop = () => {};
const model: CacheModel = {
  totals: { cacheReadTokens: 1250, cacheWriteTokens: 750, readPartial: true, writePartial: false },
  rows: [
    {
      authIndex: 'credential-a',
      provider: 'claude',
      model: 'sonnet',
      cacheReadTokens: 1200,
      cacheWriteTokens: 700,
      readPartial: true,
      writePartial: false,
    },
    {
      authIndex: 'unknown',
      provider: 'codex',
      model: 'unknown',
      cacheReadTokens: 50,
      cacheWriteTokens: 50,
      readPartial: false,
      writePartial: false,
    },
  ],
  series: [
    {
      at: 1000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      readPartial: false,
      writePartial: false,
    },
    {
      at: 2000,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      readPartial: false,
      writePartial: false,
    },
  ],
};

function render(overrides: Partial<Parameters<typeof CachePageView>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n: translations },
      createElement(CachePageView, {
        model,
        range: '24h',
        onRangeChange: noop,
        storageFailed: false,
        error: null,
        ...overrides,
      })
    )
  );
}

describe('cache monitor page', () => {
  test('renders read and write totals, grouped credential rows, and partial indicators', () => {
    const markup = render();
    expect(markup).toContain('1,250');
    expect(markup).toContain('750');
    expect(markup).toContain('credential-a');
    expect(markup).toContain('claude');
    expect(markup).toContain('sonnet');
    expect(markup).toContain('codex');
    expect(markup).toContain('Partial');
    expect(markup).toContain('Unknown');
  });

  test('distinguishes covered zero buckets from history gaps', () => {
    const markup = render();
    expect(markup).toContain('data-cache-point="covered"');
    expect(markup).toContain('data-cache-point="gap"');
    expect(markup).toContain('No collector coverage');
    expect(markup).not.toContain('data-cache-point="unknown-zero"');
  });

  test('shows retention, single-collector, range, and storage-failure notices', () => {
    const markup = render({ storageFailed: true });
    expect(markup).toContain('Browser-local · 17 days · one collector');
    expect(markup).toContain('24 hours');
    expect(markup).toContain('7 days');
    expect(markup).toContain('17 days');
    expect(markup).toContain('Storage unavailable');
    expect(markup).toContain('Continuing in memory');
  });

  test('wires the page under Observe and serves the one-shot demo queue before generic usage', async () => {
    const { readFileSync } = await import('node:fs');
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
    const routes = read('../src/router/MainRoutes.tsx');
    const layout = read('../src/components/layout/MainLayout.tsx');
    const demo = read('../scripts/demo.ts');

    expect(routes).toContain("path: '/cache'");
    expect(layout).toContain("path: '/cache'");
    expect(demo).toContain("path === '/v8/management/observability/usage/queue'");
    expect(demo.indexOf("path === '/v8/management/observability/usage/queue'")).toBeLessThan(
      demo.indexOf("path.includes('/usage')")
    );
    expect(demo).toContain('cacheQueueFixture = null');
  });
});
