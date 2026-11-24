import { describe, expect, it } from 'vitest';
import { comparisonGeometry } from '../../src/lib/geometry';
import { configSchema, localConfigSchema } from '../../shared/model';

describe('comparison geometry', () => {
  const a = { width: 1200, height: 600 };
  const b = { width: 800, height: 1200 };
  it.each([
    ['original', 1, { width: 800, height: 1200 }, { width: 1200, height: 1200 }],
    ['width', 1.5, { width: 1200, height: 1800 }, { width: 1200, height: 1800 }],
    ['height', 0.5, { width: 400, height: 600 }, { width: 1200, height: 600 }],
  ] as const)(
    'computes %s relative scale, rectangle and union',
    (mode, relativeScale, alignedB, bounds) => {
      expect(comparisonGeometry(a, b, mode)).toEqual({ relativeScale, alignedB, bounds });
      const swapped = comparisonGeometry(b, a, mode);
      expect(swapped.relativeScale).toBeCloseTo(1 / relativeScale, 12);
    },
  );

  it('keeps equal sizes equivalent and matches either dimension at a common aspect ratio', () => {
    const small = { width: 400, height: 200 };
    for (const [first, second] of [
      [a, a],
      [a, small],
      [small, a],
    ]) {
      expect(comparisonGeometry(first, second, 'width')).toEqual(
        comparisonGeometry(first, second, 'height'),
      );
      expect(comparisonGeometry(first, second, 'width').alignedB).toEqual(first);
    }
  });

  it('keeps the legacy public manifest shape and accepts large centers for local views', () => {
    const config = {
      mode: 'split',
      selected: [0, 1],
      divider: 0.5,
      view: { zoom: null, center: { x: 600, y: 600 } },
    };
    expect(configSchema.parse(config)).toEqual(config);
    expect(configSchema.parse({ ...config, alignment: 'width' }).alignment).toBe('width');
    expect(configSchema.safeParse({ ...config, alignment: 'stretch' }).success).toBe(false);
    expect(
      localConfigSchema.safeParse({
        ...config,
        view: { zoom: 1, center: { x: 8192, y: 134_217_728 } },
      }).success,
    ).toBe(true);
  });
});
