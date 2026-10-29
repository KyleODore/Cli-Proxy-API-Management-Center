import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parse as parseYaml } from 'yaml';
import { parseRoutingStrategy, useVisualConfig } from '../src/hooks/useVisualConfig';
import { searchConfigFields } from '../src/features/config/searchIndex';
import { runVisualConfig } from './helpers/visualConfig';

describe('visual config weighted routing strategy', () => {
  test('recognizes the weighted-round-robin backend value', () => {
    expect(parseRoutingStrategy('weighted-round-robin')).toBe('weighted-round-robin');
    expect(parseRoutingStrategy('weightedroundrobin')).toBe('weighted-round-robin');
    expect(parseRoutingStrategy('wrr')).toBe('weighted-round-robin');
    expect(parseRoutingStrategy('fill-first')).toBe('fill-first');
    expect(parseRoutingStrategy('fillfirst')).toBe('fill-first');
    expect(parseRoutingStrategy('ff')).toBe('fill-first');
    expect(parseRoutingStrategy(undefined)).toBe('round-robin');
  });

  test('writes weighted-round-robin without coercing it to round-robin', () => {
    function Harness() {
      const visualConfig = useVisualConfig();
      const [phase, setPhase] = useState(0);

      if (phase === 0) {
        visualConfig.setVisualValues({ routingStrategy: 'weighted-round-robin' });
        setPhase(1);
      } else {
        return createElement(
          'pre',
          null,
          visualConfig.applyVisualChangesToYaml('routing:\n  strategy: round-robin\n')
        );
      }

      return null;
    }

    const markup = renderToStaticMarkup(createElement(Harness));
    const result = markup.slice('<pre>'.length, -'</pre>'.length);

    expect(parseYaml(result)).toEqual({ routing: { strategy: 'weighted-round-robin' } });
  });

  test('parses and serializes soonest-reset without coercion', () => {
    expect(parseRoutingStrategy('soonest-reset')).toBe('soonest-reset');

    const yaml = 'routing:\n  strategy: soonest-reset\n  session-affinity: false\n';
    const loaded = runVisualConfig(yaml);
    expect(loaded.visualValues.routingStrategy).toBe('soonest-reset');
    expect(parseYaml(loaded.applyVisualChangesToYaml(yaml))).toEqual({
      routing: { strategy: 'soonest-reset', 'session-affinity': false },
    });

    const edited = runVisualConfig(yaml, [{ routingStrategy: 'soonest-reset' }]);
    expect(parseYaml(edited.applyVisualChangesToYaml(yaml))).toEqual({
      routing: { strategy: 'soonest-reset', 'session-affinity': false },
    });
  });

  test('offers and finds soonest-reset in the visual editor', () => {
    const section = readFileSync(
      new URL('../src/features/config/components/sections/SectionNetwork.tsx', import.meta.url),
      'utf8'
    );
    expect(section).toContain("value: 'soonest-reset'");
    expect(
      searchConfigFields('soonest-reset', (key) => key).map((entry) => entry.fieldId)
    ).toContain('routingStrategy');
  });
});
