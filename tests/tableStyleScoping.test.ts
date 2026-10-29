import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const stylesheets = [
  '../src/features/routing/RoutingPage.module.scss',
  '../src/features/cache/CachePage.module.scss',
];

describe('feature table style scoping', () => {
  for (const path of stylesheets) {
    test(`${path} has no unscoped table selectors`, () => {
      const source = readFileSync(new URL(path, import.meta.url), 'utf8');
      const topLevelTableRules = source
        .split(/\r?\n/)
        .filter((line) => /^(?:table|tbody|th|td)\b/.test(line));

      expect(topLevelTableRules).toEqual([]);
      expect(source).toMatch(/\.tableWrap\s*\{[\s\S]*?\btable\s*\{/);
    });
  }
});
