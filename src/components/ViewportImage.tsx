import { useLayoutEffect, useRef } from 'react';
import type { LocalImage } from '../../shared/model';
import type { Point, Size } from '../lib/geometry';

// Large aligned layers can exceed browser layout and transform coordinate limits.
export function ViewportImage({
  image,
  origin,
  scale,
  panel,
  panelOffset,
  dpr,
  pixelated,
  onError,
}: {
  image: LocalImage;
  origin: Point;
  scale: number;
  panel: Size;
  panelOffset: number;
  dpr: number;
  pixelated: boolean;
  onError?: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const source = useRef<HTMLImageElement>(null);
  const draw = () => {
    const context = canvas.current?.getContext('2d');
    if (!context || panel.width <= 0 || panel.height <= 0) return;
    const bitmap = source.current;
    const { width, height } = context.canvas;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, width, height);
    if (!bitmap?.naturalWidth) return;

    const left = Math.max(0, origin.x);
    const top = Math.max(0, origin.y);
    const right = Math.min(panel.width, origin.x + image.width * scale);
    const bottom = Math.min(panel.height, origin.y + image.height * scale);
    if (left >= right || top >= bottom) return;

    context.setTransform(width / panel.width, 0, 0, height / panel.height, 0, 0);
    context.imageSmoothingEnabled = !pixelated;
    context.drawImage(
      bitmap,
      (left - origin.x) / scale,
      (top - origin.y) / scale,
      (right - left) / scale,
      (bottom - top) / scale,
      left,
      top,
      right - left,
      bottom - top,
    );
  };
  useLayoutEffect(draw);

  return (
    <>
      <img
        ref={source}
        data-testid="image-B"
        src={image.url}
        onLoad={draw}
        onError={onError}
        alt={image.label}
        className="sr-only"
        draggable={false}
      />
      <canvas
        ref={canvas}
        data-testid="viewport-image-B"
        aria-hidden="true"
        className="comparison-image"
        width={Math.max(1, Math.round(panel.width * dpr))}
        height={Math.max(1, Math.round(panel.height * dpr))}
        style={{ left: panelOffset, top: 0, width: panel.width, height: panel.height }}
      />
    </>
  );
}
