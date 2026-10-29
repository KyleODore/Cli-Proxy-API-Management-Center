/** Local, read-only fixture hub. No upstream API request is forwarded anywhere. */
import { readFileSync } from 'node:fs';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { normalizeAccount } from '../src/features/quota/pool/normalize';
import { aggregate, available, compactHistory, HOUR } from '../src/features/quota/pool/model';
import type { QuotaFileEntry } from '../src/features/quota/logic';

const port = Number(process.env.PROX_DEMO_PORT ?? 8318);
const now = Date.now();
const base = `http://127.0.0.1:${port}`;
const entries: QuotaFileEntry[] = Array.from({ length: 9 }, (_, i) => {
  const claude = i < 6,
    j = claude ? i : i - 6;
  const capacity = !claude && j === 2 ? 250 : 100;
  const remaining = claude ? [95, 89, 98, 87, 92, 94][j] : [95, 94, 232][j];
  const reset = now + (claude ? [24, 36, 52, 62, 70, 82][j] : 166) * HOUR;
  const signals = claude
    ? {
        'Anthropic-Ratelimit-Unified-5h-Utilization': String(1 - remaining / capacity),
        'Anthropic-Ratelimit-Unified-5h-Reset': String((now + (j + 1) * HOUR) / 1000),
        'Anthropic-Ratelimit-Unified-7d-Utilization': String((1 - remaining / capacity) / 2),
        'Anthropic-Ratelimit-Unified-7d-Reset': String(reset / 1000),
      }
    : {
        'X-Codex-Primary-Used-Percent': String(100 * (1 - remaining / capacity)),
        'X-Codex-Primary-Reset-At': String((now + 4 * HOUR) / 1000),
        'X-Codex-Secondary-Used-Percent': String(50 * (1 - remaining / capacity)),
        'X-Codex-Secondary-Reset-At': String(reset / 1000),
      };
  return {
    type: claude ? 'claude' : 'codex',
    file: {
      name: `${claude ? 'claude' : 'codex'}-${j + 1}.json`,
      type: claude ? 'claude' : 'codex',
      provider: claude ? 'claude' : 'codex',
      email: `demo-${i + 1}@example.com`,
      authIndex: i + 1,
      auth_index: String(i + 1),
      chatgpt_account_id: `demo-account-${i + 1}`,
      planType: capacity === 250 ? 'pro_max' : 'plus',
      quota: { signals },
    },
  };
});
const pools = aggregate(
  entries.map((e) => normalizeAccount(e, undefined, now)!),
  now
);
const histories = Object.fromEntries(
  pools.map((pool) => {
    const controls =
      pool.provider === 'claude'
        ? [
            [-72, 580],
            [-48, 480],
            [-36, 445],
            [-30, 410],
            [-30, 510],
            [-20, 450],
            [-20, 590],
            [-6, 577.2],
            [0, 555],
          ]
        : [
            [-72, 450],
            [-66, 220],
            [-66, 450],
            [-60, 215],
            [-60, 450],
            [-50, 195],
            [-32, 190],
            [-32, 240],
            [-24, 210],
            [-24, 420],
            [-10, 350],
            [-9, 445],
            [-6, 437.2],
            [0, 421],
          ];
    const points = Array.from({ length: 72 * 120 + 1 }, (_, i) => {
      const hours = -72 + i / 120;
      let before = controls[0],
        after = controls[controls.length - 1];
      for (const control of controls) {
        if (control[0] <= hours) before = control;
        else {
          after = control;
          break;
        }
      }
      const remaining =
        before[0] === after[0]
          ? before[1]
          : before[1] + ((after[1] - before[1]) * (hours - before[0])) / (after[0] - before[0]);
      return {
        at: now + hours * HOUR,
        remaining,
        capacity: pool.capacity,
        signature: pool.signature,
      };
    });
    return [pool.provider, compactHistory(points, now)];
  })
);
const storageKey = `prox.history.v1.${bytesToHex(sha256(new TextEncoder().encode(`${base}\0prox-demo`)))}`;
const script = `<script>try { localStorage.setItem(${JSON.stringify(storageKey)}, ${JSON.stringify(JSON.stringify(histories))}); } catch {} document.documentElement.dataset.proxDemo='true';</script>`;
const html = readFileSync('dist/management.html', 'utf8')
  .replace('<head>', `<head>${script}`)
  .replace(
    '<body>',
    '<body><div style="position:fixed;bottom:8px;right:12px;z-index:99999;background:#16251f;color:#7ee7bd;border:1px solid #24513e;border-radius:6px;padding:6px 10px;font:11px monospace;pointer-events:none">LOCAL DEMO · SYNTHETIC DATA</div>'
  );
const config = {
  server: { host: '127.0.0.1', port },
  management: { 'allow-remote': false, 'disable-auto-update-panel': true },
  observability: { logs: { 'logging-to-file': true, 'request-log': true } },
  access: { 'api-keys': [] },
  routing: { strategy: 'soonest-reset' },
  providers: {},
  credentials: {},
  oauth: {},
};
const routingStatus = {
  strategy: 'soonest-reset',
  generated_at: new Date(now).toISOString(),
  session_affinity: { enabled: true, ttl: '1h0m0s' },
  providers: {
    claude: [
      {
        auth_index: '1',
        rank: 1,
        state: 'eligible',
        reason: 'known',
        priority: 20,
        weekly_reset: new Date(now + 7 * 24 * HOUR).toISOString(),
        observed_at: new Date(now).toISOString(),
        probe_pending: false,
      },
      {
        auth_index: '2',
        rank: 2,
        state: 'exhausted',
        reason: 'known',
        priority: 1,
        weekly_reset: new Date(now + 2 * 24 * HOUR).toISOString(),
        exhausted_until: new Date(now + 24 * HOUR).toISOString(),
        probe_pending: false,
      },
      {
        auth_index: '3',
        rank: 3,
        state: 'eligible',
        reason: 'probe',
        priority: 0,
        probe_pending: true,
      },
    ],
  },
};
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'X-CPA-Version': '8.0.0-prox-demo' } });
const server = Bun.serve({
  hostname: '127.0.0.1',
  port,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/v1/models') return json({ object: 'list', data: [] });
    if (path === '/' || path === '/management.html')
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (request.headers.get('authorization') !== 'Bearer prox-demo')
      return json({ error: 'Use the local fixture key: prox-demo' }, 401);
    if (path === '/v8/management/config') return json(config);
    if (path === '/v8/management/routing/status') return json(routingStatus);
    if (path === '/v8/management/config.yaml')
      return new Response(
        'server:\n  host: 127.0.0.1\n  port: 8318\nmanagement:\n  disable-auto-update-panel: true\n',
        { headers: { 'content-type': 'text/yaml' } }
      );
    if (path === '/v8/management/credentials') return json({ files: entries.map((e) => e.file) });
    if (path === '/v8/management/requests/api-call' && request.method === 'POST') {
      const operation = (await request.json()) as {
        url: string;
        authIndex: string;
        method: string;
      };
      if (operation.method !== 'GET') return json({ error: 'Demo is read-only' }, 405);
      const i = Number(operation.authIndex) - 1,
        entry = entries[i] ?? entries[0],
        a = normalizeAccount(entry, undefined, now)!;
      const prior = entries
        .slice(0, i)
        .filter((e) => e.type === entry.type)
        .reduce((sum, e) => sum + available(normalizeAccount(e, undefined, now)!, now), 0);
      const demand = ((entry.type === 'claude' ? 3.7 : 2.7) * (Date.now() - now)) / HOUR;
      const used = Math.min(available(a, now), Math.max(0, demand - prior));
      a.windows.forEach((window) => {
        window.remaining = Math.max(0, window.remaining - used);
      });

      let body: unknown = {};
      if (operation.url.includes('usage')) {
        if (entry.type === 'claude')
          body = {
            five_hour: {
              utilization: 100 * (1 - a.windows[0].remaining / a.capacity),
              resets_at: new Date(a.windows[0].resetAt!).toISOString(),
            },
            seven_day: {
              utilization: 100 * (1 - a.windows[1].remaining / a.capacity),
              resets_at: new Date(a.windows[1].resetAt!).toISOString(),
            },
          };
        else
          body = {
            plan_type: a.capacity === 250 ? 'pro_max' : 'plus',
            rate_limit: {
              primary_window: {
                used_percent: 100 * (1 - a.windows[0].remaining / a.capacity),
                reset_at: a.windows[0].resetAt! / 1000,
                limit_window_seconds: 18000,
              },
              secondary_window: {
                used_percent: 100 * (1 - a.windows[1].remaining / a.capacity),
                reset_at: a.windows[1].resetAt! / 1000,
                limit_window_seconds: 604800,
              },
            },
            rate_limit_reset_credits: { available_count: 0 },
          };
      } else if (operation.url.includes('profile'))
        body = { account: { has_claude_pro: true, has_claude_max: false } };
      else if (operation.url.includes('credits') || operation.url.includes('grants'))
        body = { credits: [], grants: [], available_count: 0 };
      return json({ status_code: 200, header: {}, body });
    }
    if (request.method !== 'GET') return json({ error: 'Local demo: mutations are disabled' }, 405);
    if (path.includes('/logs'))
      return json({
        lines: [
          `[${new Date(now).toISOString()}] [info] prox local fixture hub — synthetic data only`,
        ],
        files: [],
        latest_timestamp: Math.floor(now / 1000),
      });
    if (path.includes('/usage'))
      return json({
        usage: { total_requests: 0, success_count: 0, failure_count: 0, total_tokens: 0, apis: {} },
        failed_requests: 0,
      });
    if (path.includes('/models')) return json({ models: [], data: [] });
    if (path.includes('excluded-models') || path.includes('model-alias')) return json({});
    if (path.includes('/credentials/')) return json({ grants: [], credits: [], remaining: 0 });
    return json({});
  },
});
console.log(
  `\nprox local demo: ${base}/management.html#/quota\nManagement key: prox-demo\nSynthetic history is seeded locally. This hub never forwards requests.\n`
);
const stop = () => {
  server.stop();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
