import { expect, it } from 'vitest';
import { compactWebLayout, isLandscapeScreen } from '../../src/lib/web-viewport';

it('requires the primary coarse pointer, no hover, physical landscape and both size limits', () => {
  for (const [width, height] of [
    [844, 390],
    [900, 412],
    [500, 240],
    [1120, 620],
  ])
    expect(compactWebLayout(true, true, width, height)).toBe(true);
  for (const [coarse, landscape, width, height] of [
    [false, true, 900, 412],
    [true, false, 900, 412],
    [true, true, 1121, 412],
    [true, true, 900, 621],
  ] as const)
    expect(compactWebLayout(coarse, landscape, width, height)).toBe(false);
});

it('prefers Screen Orientation, then the legacy angle, then screen dimensions rather than keyboard viewport dimensions', () => {
  const portrait = { width: 412, height: 900 };
  const landscape = { width: 900, height: 412 };
  expect(isLandscapeScreen('portrait-primary', 90, landscape)).toBe(false);
  expect(isLandscapeScreen('landscape-secondary', 0, portrait)).toBe(true);
  expect(isLandscapeScreen(undefined, -90, portrait)).toBe(true);
  expect(isLandscapeScreen(undefined, 180, landscape)).toBe(false);
  expect(isLandscapeScreen(undefined, undefined, portrait)).toBe(false);
  expect(isLandscapeScreen(undefined, undefined, landscape)).toBe(true);
});
