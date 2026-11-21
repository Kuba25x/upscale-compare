import { expect, it } from 'vitest';
import { compactWebLayout, isLandscapeScreen, mobileWebControls } from '../../src/lib/web-viewport';
import { phoneOrientation } from '../../src/lib/comparison-presentation';

it('uses the screen short edge and physical orientation for phone presentation', () => {
  expect(phoneOrientation({ width: 390, height: 844 }, false)).toBe('portrait');
  expect(phoneOrientation({ width: 844, height: 390 }, true)).toBe('landscape');
  expect(phoneOrientation({ width: 1280, height: 600 }, true)).toBeUndefined();
  expect(phoneOrientation({ width: 0, height: 844 }, false)).toBeUndefined();
});

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

it('offers minimalist entry to mobile primary input in either orientation without changing desktop fullscreen', () => {
  for (const width of [390, 900, 1120]) expect(mobileWebControls(true, width)).toBe(true);
  expect(mobileWebControls(true, 1121)).toBe(false);
  expect(mobileWebControls(false, 390)).toBe(false);
});
