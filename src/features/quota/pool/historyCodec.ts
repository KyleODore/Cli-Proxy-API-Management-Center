import type { Sample } from './model';

export type Histories = Record<string, Sample[]>;
export function decodeHistories(raw: string): Histories {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    if ('version' in parsed && parsed.version !== 2) return {};
    const result: Histories = {};
    const compressed =
      'version' in parsed &&
      parsed.version === 2 &&
      'providers' in parsed &&
      'signatures' in parsed &&
      Array.isArray(parsed.signatures);
    const source = compressed
      ? (parsed as { providers: Record<string, unknown> }).providers
      : parsed;
    const signatures = compressed ? (parsed as { signatures: string[] }).signatures : [];
    if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
    for (const [provider, rows] of Object.entries(source)) {
      if (!Array.isArray(rows)) continue;
      const expanded: unknown[] = compressed
        ? rows.map((row: unknown) =>
            Array.isArray(row)
              ? {
                  at: row[0],
                  remaining: row[1],
                  capacity: row[2],
                  signature: signatures[row[3]],
                  resetAt: row[4] ?? undefined,
                }
              : null
          )
        : rows;
      result[provider] = expanded.filter((s: unknown): s is Sample =>
        Boolean(
          s &&
          typeof s === 'object' &&
          'at' in s &&
          typeof s.at === 'number' &&
          Number.isFinite(s.at) &&
          'remaining' in s &&
          typeof s.remaining === 'number' &&
          Number.isFinite(s.remaining) &&
          'capacity' in s &&
          typeof s.capacity === 'number' &&
          Number.isFinite(s.capacity) &&
          'signature' in s &&
          typeof s.signature === 'string' &&
          (!('resetAt' in s) ||
            s.resetAt === undefined ||
            (typeof s.resetAt === 'number' && Number.isFinite(s.resetAt)))
        )
      );
    }
    return result;
  } catch {
    return {};
  }
}
/** Store membership signatures once, rather than repeating them in every sample. */
export function encodeHistories(histories: Histories): string {
  const signatures = [
    ...new Set(Object.values(histories).flatMap((rows) => rows.map((sample) => sample.signature))),
  ];
  const indices = new Map(signatures.map((signature, index) => [signature, index]));
  const providers = Object.fromEntries(
    Object.entries(histories).map(([provider, rows]) => [
      provider,
      rows.map((sample) => [
        sample.at,
        Number(sample.remaining.toFixed(5)),
        sample.capacity,
        indices.get(sample.signature),
        sample.resetAt ?? null,
      ]),
    ])
  );
  return JSON.stringify({ version: 2, signatures, providers });
}
