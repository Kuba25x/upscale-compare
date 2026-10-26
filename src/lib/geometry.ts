import type { View } from '../../shared/model';

export interface Size {
  width: number;
  height: number;
}
export interface Point {
  x: number;
  y: number;
}
export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
export function scaleFor(view: View, panel: Size, image: Size, dpr: number): number {
  return view.zoom === null
    ? Math.min(panel.width / image.width, panel.height / image.height)
    : view.zoom / dpr;
}
export function originFor(view: View, panel: Size, scale: number, dpr: number): Point {
  const origin = {
    x: panel.width / 2 - view.center.x * scale,
    y: panel.height / 2 - view.center.y * scale,
  };
  // Snap to physical pixels at integer source-pixel zoom levels.
  if (view.zoom !== null && Number.isInteger(view.zoom)) {
    return { x: Math.round(origin.x * dpr) / dpr, y: Math.round(origin.y * dpr) / dpr };
  }
  return origin;
}
export function zoomAt(
  view: View,
  oldScale: number,
  nextZoom: number,
  offset: Point,
  dpr: number,
  panel?: Size,
): View {
  const zoom = clamp(nextZoom, 0.025, 16);
  const nextScale = zoom / dpr;
  const origin = panel ? originFor(view, panel, oldScale, dpr) : null;
  const center =
    panel && origin
      ? { x: (panel.width / 2 - origin.x) / oldScale, y: (panel.height / 2 - origin.y) / oldScale }
      : view.center;
  return {
    zoom,
    center: {
      x: center.x + offset.x / oldScale - offset.x / nextScale,
      y: center.y + offset.y / oldScale - offset.y / nextScale,
    },
  };
}
export function panBy(view: View, delta: Point, scale: number): View {
  return {
    ...view,
    center: { x: view.center.x - delta.x / scale, y: view.center.y - delta.y / scale },
  };
}
