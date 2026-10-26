import { describe, expect, it } from 'vitest';
import { originFor, panBy, scaleFor, zoomAt } from '../../src/lib/geometry';
import { manifestSchema, emptyMetadata, emptyImageMetadata, type View } from '../../shared/model';
const panel = { width: 1000, height: 600 },
  image = { width: 2000, height: 1000 };
const fit: View = { zoom: null, center: { x: 1000, y: 500 } };
describe('shared image coordinates', () => {
  it('fits without cropping or stretching', () => {
    expect(scaleFor(fit, panel, image, 1)).toBe(0.5);
    expect(originFor(fit, panel, 0.5, 1)).toEqual({ x: 0, y: 50 });
  });
  it.each([1, 1.25, 2, 3])('maps source pixels to physical pixels at DPR %s', (dpr) => {
    expect(scaleFor({ ...fit, zoom: 1 }, panel, image, dpr) * dpr).toBe(1);
  });
  it('keeps the cursor image coordinate fixed while zooming', () => {
    const offset = { x: 170, y: -120 };
    const next = zoomAt(fit, 0.5, 2, offset, 2);
    expect(next.center.x + offset.x / 1).toBe(fit.center.x + offset.x / 0.5);
    expect(next.center.y + offset.y / 1).toBe(fit.center.y + offset.y / 0.5);
  });
  it('pans both panels by the same source distance', () => {
    const moved = panBy(fit, { x: 20, y: -40 }, 0.5);
    expect(moved.center).toEqual({ x: 960, y: 580 });
  });
  it('snaps the origin to physical pixels at integer magnification', () => {
    const origin = originFor({ zoom: 1, center: { x: 123.33, y: 77.78 } }, panel, 0.5, 2);
    expect((origin.x * 2) % 1).toBe(0);
    expect((origin.y * 2) % 1).toBe(0);
  });
  it('bounds extreme zoom input', () => {
    expect(zoomAt(fit, 0.5, 100, { x: 0, y: 0 }, 1).zoom).toBe(16);
    expect(zoomAt(fit, 0.5, 0, { x: 0, y: 0 }, 1).zoom).toBe(0.025);
  });
});
describe('publication manifest', () => {
  const valid = () => ({
    metadata: emptyMetadata(),
    images: ['DLSS', 'FSR'].map((label) => ({ label, metadata: emptyImageMetadata() })),
    config: { mode: 'split', selected: [0, 1], divider: 0.5, view: fit },
  });
  it('accepts custom labels and optional empty metadata', () =>
    expect(manifestSchema.safeParse(valid()).success).toBe(true));
  it('rejects selecting the same image twice', () => {
    const data = valid();
    data.config.selected = [0, 0];
    expect(manifestSchema.safeParse(data).success).toBe(false);
  });
  it('rejects references to absent images', () => {
    const data = valid();
    data.config.selected = [0, 3];
    expect(manifestSchema.safeParse(data).success).toBe(false);
  });
  it('rejects unbounded and unknown metadata', () => {
    expect(manifestSchema.safeParse({ ...valid(), script: '<script>' }).success).toBe(false);
    const data = valid();
    data.images[0].label = 'x'.repeat(121);
    expect(manifestSchema.safeParse(data).success).toBe(false);
  });
});
