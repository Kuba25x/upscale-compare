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
export function originFor(
  view: View,
  panel: Size,
  scale: number,
  dpr: number,
  panelPosition: Point = { x: 0, y: 0 },
): Point {
  const origin = {
    x: panel.width / 2 - view.center.x * scale,
    y: panel.height / 2 - view.center.y * scale,
  };
  // Snap to physical pixels at integer source-pixel zoom levels.
  if (view.zoom !== null && Number.isInteger(view.zoom)) {
    return {
      x: Math.round((origin.x + panelPosition.x) * dpr) / dpr - panelPosition.x,
      y: Math.round((origin.y + panelPosition.y) * dpr) / dpr - panelPosition.y,
    };
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
  panelPosition?: Point,
): View {
  const zoom = clamp(nextZoom, 0.025, 16);
  const nextScale = zoom / dpr;
  const origin = panel ? originFor(view, panel, oldScale, dpr, panelPosition) : null;
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

export function pinchAt(
  view: View,
  oldScale: number,
  nextZoom: number,
  oldOffset: Point,
  nextOffset: Point,
  dpr: number,
  panel: Size,
  panelPosition: Point,
): View {
  const zoom = clamp(nextZoom, 0.025, 16);
  const nextScale = zoom / dpr;
  const origin = originFor(view, panel, oldScale, dpr, panelPosition);
  // Use the rendered source point once; snapping an intermediate pan introduces drift.
  return {
    zoom,
    center: {
      x: (panel.width / 2 + oldOffset.x - origin.x) / oldScale - nextOffset.x / nextScale,
      y: (panel.height / 2 + oldOffset.y - origin.y) / oldScale - nextOffset.y / nextScale,
    },
  };
}
