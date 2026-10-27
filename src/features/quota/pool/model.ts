import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/** Quota points: an ordinary account is 100; configured Pro Max is 250. */
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export interface PoolWindow {
  id: string;
  remaining: number;
  resetAt: number | null;
  /** Only explicitly recurring calendar windows may repeat. Rolling sessions do not. */
  repeatMs?: number;
  durationMs?: number;
}
export interface PoolAccount {
  id: string;
  provider: string;
  capacity: number;
  windows: PoolWindow[];
  blockedUntil?: number;
}
export interface Pool {
  provider: string;
  accounts: PoolAccount[];
  capacity: number;
  remaining: number;
  unknown: number;
  signature: string;
}
export interface Sample {
  at: number;
  remaining: number;
  capacity: number;
  signature: string;
  /** Earliest known reset, for reset-aware burn estimation. */
  resetAt?: number;
}
export interface Vertex {
  at: number;
  value: number;
  kind: 'now' | 'drain' | 'reset' | 'empty';
  boost?: number;
}
export interface Projection {
  points: Vertex[];
  emptyAt: number | null;
  firstEmptyAt: number | null;
}
export const clamp = (n: number, max = 100) => Math.max(0, Math.min(max, n));
export function available(account: PoolAccount, at: number): number {
  if (account.blockedUntil && account.blockedUntil > at) return 0;
  return account.windows.length
    ? Math.min(...account.windows.map((window) => clamp(window.remaining, account.capacity)))
    : 0;
}
export function aggregate(accounts: PoolAccount[], now: number): Pool[] {
  const groups = new Map<string, PoolAccount[]>();
  accounts.forEach((account) =>
    groups.set(account.provider, [...(groups.get(account.provider) ?? []), account])
  );
  return [...groups].map(([provider, members]) => ({
    provider,
    accounts: members,
    capacity: members.reduce((sum, account) => sum + account.capacity, 0),
    remaining: members.reduce((sum, account) => sum + available(account, now), 0),
    unknown: members.filter((account) => !account.windows.length).length,
    signature: bytesToHex(
      sha256(
        new TextEncoder().encode(
          JSON.stringify(
            members
              .map((account) => [
                account.id,
                account.capacity,
                account.windows.map((w) => w.id).sort(),
              ])
              .sort()
          )
        )
      )
    ),
  }));
}

/**
 * Event-driven simulation, without a sampled time grid. Consumption is routed to
 * the available account with the earliest known reset (stable identity tie-break).
 * Every applicable window on that account spends the same normalized quota points.
 * A reset refreshes its own window; only the resulting effective gain is added.
 * Short rolling windows have ONE known event: inventing 67 future sessions would
 * create false capacity. Weekly/calendar recurrence is an explicit input assumption.
 */
export function project(pool: Pool, now: number, until: number, burn: number): Projection {
  if (!Number.isFinite(now) || !Number.isFinite(until) || until < now || pool.unknown) {
    return { points: [], emptyAt: null, firstEmptyAt: null };
  }
  const rate = Number.isFinite(burn) ? Math.max(0, burn) : 0;
  const accounts = pool.accounts.map((a) => ({ ...a, windows: a.windows.map((w) => ({ ...w })) }));
  const events = new Map<number, { account: number; window: number }[]>();
  accounts.forEach((account, ai) => {
    account.windows.forEach((window, wi) => {
      if (window.resetAt === null || !Number.isFinite(window.resetAt)) return;
      const period = window.repeatMs && window.repeatMs >= DAY ? window.repeatMs : 0;
      // Expired reports have already been normalized to full; do not invent a new anchor.
      if (window.resetAt <= now) return;
      for (let at = window.resetAt, count = 0; at <= until && count < 1000; at += period, count++) {
        events.set(at, [...(events.get(at) ?? []), { account: ai, window: wi }]);
        if (!period) break;
      }
    });
    if (account.blockedUntil && account.blockedUntil > now && account.blockedUntil <= until) {
      events.set(account.blockedUntil, [
        ...(events.get(account.blockedUntil) ?? []),
        { account: ai, window: -1 },
      ]);
    }
  });
  const total = (at: number) => accounts.reduce((sum, account) => sum + available(account, at), 0);
  let cursor = now;
  let value = total(now);
  let emptyAt: number | null = value <= 0 ? now : null;
  let firstEmptyAt: number | null = null;
  const points: Vertex[] = [{ at: now, value, kind: 'now' }];
  const drainTo = (end: number) => {
    const startValue = value;
    let spend = rate * ((end - cursor) / HOUR);
    let spent = 0;
    const sorted = [...accounts].sort((a, b) => {
      const next = (account: PoolAccount) =>
        Math.min(
          ...account.windows.map((w) =>
            w.resetAt === null
              ? Infinity
              : w.resetAt > cursor
                ? w.resetAt
                : w.repeatMs && w.repeatMs >= DAY
                  ? w.resetAt + (Math.floor((cursor - w.resetAt) / w.repeatMs) + 1) * w.repeatMs
                  : Infinity
          )
        );
      return next(a) - next(b) || a.id.localeCompare(b.id);
    });
    for (const account of sorted) {
      const left = available(account, cursor);
      const used = Math.min(left, spend);
      if (left > 0 && used >= left && rate > 0 && firstEmptyAt === null) {
        firstEmptyAt = cursor + ((spent + left) / rate) * HOUR;
      }
      account.windows.forEach((window) => {
        window.remaining = clamp(window.remaining - used, account.capacity);
      });
      spend -= used;
      spent += used;
    }
    value = Math.max(0, startValue - spent);
    if (rate > 0 && startValue > 0 && rate * ((end - cursor) / HOUR) >= startValue) {
      const at = cursor + (startValue / rate) * HOUR;
      if (emptyAt === null) emptyAt = at;
      points.push({ at, value: 0, kind: 'empty' });
    }
    if (end > cursor) points.push({ at: end, value, kind: 'drain' });
    cursor = end;
  };
  for (const [at, resets] of [...events].sort(([a], [b]) => a - b)) {
    drainTo(at);
    const before = value;
    for (const reset of resets) {
      const account = accounts[reset.account];
      if (reset.window < 0) account.blockedUntil = undefined;
      else {
        const refreshed = account.windows[reset.window];
        refreshed.remaining = account.capacity;
        // Macro forecast: a known calendar renewal also releases elapsed shorter
        // sessions. This is an explicit sustained-usage scenario, not a promise
        // that the router will choose this account or start its next session here.
        if (refreshed.durationMs && refreshed.durationMs >= DAY) {
          account.windows.forEach((shorter) => {
            if (
              shorter.durationMs &&
              shorter.durationMs < refreshed.durationMs! &&
              shorter.resetAt !== null &&
              shorter.resetAt <= at
            )
              shorter.remaining = account.capacity;
          });
        }
      }
    }
    value = Math.min(pool.capacity, total(at));
    if (value - before > 0.00001) points.push({ at, value, kind: 'reset', boost: value - before });
  }
  drainTo(until);
  return { points, emptyAt, firstEmptyAt };
}

/** Raw endpoint slope, with observed reset-free segments as its fallback. */
export function estimateBurn(
  history: Sample[],
  now: number,
  hours: number,
  signature: string
): number | null {
  const samples = history.filter(
    (s) => s.signature === signature && s.at >= now - hours * HOUR && s.at <= now
  );
  if (samples.length < 2) return null;
  let loss = 0;
  let elapsed = 0;
  let reset = false;
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const curr = samples[i];
    const dt = curr.at - prev.at;
    const crosses = prev.resetAt !== undefined && prev.resetAt > prev.at && prev.resetAt <= curr.at;
    if (dt > 10 * 60_000 || curr.remaining > prev.remaining || crosses) {
      reset = true;
      continue;
    }
    // A suspended browser is not evidence of a continuously measured burn rate.
    if (dt > 0 && dt <= 10 * 60_000) {
      loss += prev.remaining - curr.remaining;
      elapsed += dt;
    }
  }
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (elapsed < 30_000) return null;
  const endpoint = ((first.remaining - last.remaining) * HOUR) / (last.at - first.at);
  return Math.max(0, reset || endpoint < 0 ? (loss * HOUR) / elapsed : endpoint);
}

/** Retain 30-second samples for six hours; downsample older history to five minutes. */
export function compactHistory(samples: Sample[], now: number): Sample[] {
  const buckets = new Map<number, Sample>();
  for (const sample of samples) {
    if (
      !Number.isFinite(sample.at) ||
      !Number.isFinite(sample.remaining) ||
      sample.at < now - 17 * DAY ||
      sample.at > now
    )
      continue;
    const step = sample.at >= now - 6 * HOUR ? 30_000 : 300_000;
    buckets.set(Math.floor(sample.at / step) * step, sample);
  }
  return [...buckets.values()].sort((a, b) => a.at - b.at);
}
