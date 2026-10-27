import { describe, expect, test } from 'bun:test';
import { decodeHistories, encodeHistories } from '../src/features/quota/pool/historyCodec';
import { aggregate } from '../src/features/quota/pool/model';

describe('prox persisted history', () => {
  test('round trips optional resets and changed membership without repeating signatures', () => {
    const source = {
      claude: [
        { at: 100, remaining: 93.12345, capacity: 100, signature: 'one', resetAt: 900 },
        { at: 200, remaining: 90, capacity: 100, signature: 'one' },
        { at: 300, remaining: 180, capacity: 200, signature: 'two' },
      ],
    };
    const encoded = encodeHistories(source);
    expect(encoded.match(/one/g)).toHaveLength(1);
    expect(decodeHistories(encoded)).toEqual(source);
  });
  test('decodes the uncompressed demonstration fixture format', () => {
    const source = { codex: [{ at: 100, remaining: 450, capacity: 450, signature: 'fixture' }] };
    expect(decodeHistories(JSON.stringify(source))).toEqual(source);
  });
  test('rejects corrupt, future-version and non-finite observations', () => {
    expect(decodeHistories('{broken')).toEqual({});
    expect(decodeHistories('{"version":3,"providers":{}}')).toEqual({});
    expect(
      decodeHistories('{"claude":[{"at":1e999,"remaining":40,"capacity":100,"signature":"s"}]}')
    ).toEqual({ claude: [] });
    expect(
      decodeHistories('{"version":2,"signatures":[],"providers":{"claude":[[1,40,100,999]]}}')
    ).toEqual({ claude: [] });
  });
  test('keeps seventeen days of eight-provider data below ordinary storage limits', () => {
    const providers = Object.fromEntries(
      Array.from({ length: 8 }, (_, p) => [
        `provider-${p}`,
        Array.from({ length: 5500 }, (_, i) => ({
          at: 1_793_000_000_000 + i * 30_000,
          remaining: 93.125,
          capacity: 600,
          signature: 'a'.repeat(64),
        })),
      ])
    );
    expect(encodeHistories(providers).length).toBeLessThan(2_000_000);
  });
  test('membership fingerprints do not persist credential filenames', () => {
    const accounts = [
      {
        id: 'private-name@example.com.json',
        provider: 'claude',
        capacity: 100,
        windows: [{ id: 'five-hour', remaining: 90, resetAt: null }],
      },
    ];
    const p = aggregate(accounts, 0)[0];
    expect(p.signature).toMatch(/^[a-f0-9]{64}$/);
    expect(p.signature).not.toContain('example.com');
  });
});
