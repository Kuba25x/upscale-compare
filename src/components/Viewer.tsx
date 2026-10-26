import { useEffect, useRef, useState } from 'react';
import { Expand, Info, Keyboard, Minus, Plus, Shrink } from 'lucide-react';
import type { Config, LocalImage, View } from '../../shared/model';
import { clamp, originFor, panBy, scaleFor, zoomAt } from '../lib/geometry';

interface Props {
  images: LocalImage[];
  config: Config;
  onChange: (update: (previous: Config) => Config) => void;
  onMetadata: () => void;
  onHelp: () => void;
}
export function Viewer({ images, config, onChange, onMetadata, onHelp }: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [dpr, setDpr] = useState(window.devicePixelRatio || 1);
  const [fullscreen, setFullscreen] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const [panning, setPanning] = useState(false);
  const [a, b] = config.selected.map((index) => images[index]);
  const bounds = { width: Math.max(a.width, b.width), height: Math.max(a.height, b.height) };
  const panel = {
    width: config.mode === 'side' ? (size.width - 1) / 2 : size.width,
    height: size.height,
  };
  const scale = scaleFor(config.view, panel, bounds, dpr);
  const origin = originFor(config.view, panel, scale, dpr);
  const latest = useRef({ config, panel, bounds, dpr });
  latest.current = { config, panel, bounds, dpr };
  useEffect(() => {
    const resize = () => {
      if (stage.current) {
        const rect = stage.current.getBoundingClientRect();
        setSize({ width: rect.width, height: rect.height });
        setDpr(window.devicePixelRatio || 1);
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage.current!);
    window.addEventListener('resize', resize);
    const fullscreenChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', fullscreenChange);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
      document.removeEventListener('fullscreenchange', fullscreenChange);
    };
  }, []);
  const updateView = (action: (view: View) => View) =>
    onChange((previous) => ({ ...previous, view: action(previous.view) }));
  const setZoom = (zoom: number | null) =>
    updateView((view) => ({
      ...view,
      zoom,
      ...(zoom === null ? { center: { x: bounds.width / 2, y: bounds.height / 2 } } : {}),
    }));
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      onHelp();
    }
  };
  useEffect(() => {
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const {
        config: current,
        panel: currentPanel,
        bounds: currentBounds,
        dpr: ratio,
      } = latest.current;
      const rect = stage.current!.getBoundingClientRect();
      let x = event.clientX - rect.left;
      if (current.mode === 'side' && x > currentPanel.width) x -= currentPanel.width + 1;
      const offset = {
        x: x - currentPanel.width / 2,
        y: event.clientY - rect.top - currentPanel.height / 2,
      };
      onChange((previous) => {
        const oldScale = scaleFor(previous.view, currentPanel, currentBounds, ratio);
        return {
          ...previous,
          view: zoomAt(
            previous.view,
            oldScale,
            oldScale * ratio * Math.exp(-event.deltaY * 0.0015),
            offset,
            ratio,
            currentPanel,
          ),
        };
      });
    };
    stage.current!.addEventListener('wheel', wheel, { passive: false });
    return () => stage.current?.removeEventListener('wheel', wheel);
  }, [onChange]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (
        document.querySelector('dialog[open]') ||
        (event.target as HTMLElement).closest('input,select,textarea,button,[contenteditable]') ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return;
      const { panel: currentPanel, bounds: currentBounds, dpr: ratio } = latest.current;
      const fit = () =>
        onChange((previous) => ({
          ...previous,
          view: { zoom: null, center: { x: currentBounds.width / 2, y: currentBounds.height / 2 } },
        }));
      if (
        [
          '0',
          '1',
          '2',
          '4',
          '+',
          '=',
          '-',
          's',
          'v',
          'x',
          'f',
          '?',
          'ArrowLeft',
          'ArrowRight',
          'ArrowUp',
          'ArrowDown',
          '[',
          ']',
        ].includes(event.key)
      )
        event.preventDefault();
      if (event.key === '0') fit();
      if (['1', '2', '4'].includes(event.key))
        onChange((previous) => ({
          ...previous,
          view: { ...previous.view, zoom: Number(event.key) },
        }));
      if (['+', '=', '-'].includes(event.key))
        onChange((previous) => ({
          ...previous,
          view: {
            ...previous.view,
            zoom: clamp(
              scaleFor(previous.view, currentPanel, currentBounds, ratio) *
                ratio *
                (event.key === '-' ? 1 / 1.25 : 1.25),
              0.025,
              16,
            ),
          },
        }));
      if (event.key === 's' || event.key === 'v')
        onChange((previous) => ({ ...previous, mode: event.key === 's' ? 'split' : 'side' }));
      if (event.key === 'x')
        onChange((previous) => ({
          ...previous,
          selected: [previous.selected[1], previous.selected[0]],
        }));
      if (event.key === 'f') void toggleFullscreen();
      if (event.key === '?') onHelp();
      if (event.key.startsWith('Arrow')) {
        const delta = {
          x: event.key === 'ArrowLeft' ? 50 : event.key === 'ArrowRight' ? -50 : 0,
          y: event.key === 'ArrowUp' ? 50 : event.key === 'ArrowDown' ? -50 : 0,
        };
        onChange((previous) => ({
          ...previous,
          view: panBy(
            previous.view,
            delta,
            scaleFor(previous.view, currentPanel, currentBounds, ratio),
          ),
        }));
      }
      if (event.key === '[' || event.key === ']')
        onChange((previous) => {
          const next =
            (previous.selected[0] + (event.key === '[' ? -1 : 1) + images.length) % images.length;
          return {
            ...previous,
            selected:
              next === previous.selected[1]
                ? [next, previous.selected[0]]
                : [next, previous.selected[1]],
          };
        });
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [onChange, images.length, onHelp]);
  const setDivider = (clientX: number) => {
    const rect = stage.current!.getBoundingClientRect();
    onChange((previous) => ({
      ...previous,
      divider: clamp((clientX - rect.left) / rect.width, 0, 1),
    }));
  };
  const layer = (image: LocalImage, side: 'A' | 'B') => (
    <img
      className="comparison-image"
      data-testid={`image-${side}`}
      src={image.url}
      alt={image.label}
      draggable={false}
      width={image.width}
      height={image.height}
      style={{
        left: origin.x,
        top: origin.y,
        width: image.width * scale,
        height: image.height * scale,
        imageRendering: config.view.zoom !== null && config.view.zoom >= 1 ? 'pixelated' : 'auto',
      }}
    />
  );
  return (
    <div className="viewer-content">
      <div
        ref={stage}
        className={`stage ${panning ? 'panning' : ''}`}
        data-testid="stage"
        data-scale={scale}
        data-zoom={config.view.zoom ?? 'fit'}
        aria-label="Image comparison. Drag to pan, scroll to zoom."
        onDoubleClick={() => setZoom(config.view.zoom === 1 ? null : 1)}
        onPointerDown={(event) => {
          if (event.button !== 0 || (event.target as HTMLElement).closest('button,[role=slider]'))
            return;
          stage.current!.setPointerCapture(event.pointerId);
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          setPanning(true);
        }}
        onPointerMove={(event) => {
          const old = pointers.current.get(event.pointerId);
          if (!old) return;
          const before = [...pointers.current.values()];
          const next = { x: event.clientX, y: event.clientY };
          pointers.current.set(event.pointerId, next);
          if (pointers.current.size >= 2) {
            const after = [...pointers.current.values()];
            const oldDistance = Math.hypot(before[1].x - before[0].x, before[1].y - before[0].y);
            const distance = Math.hypot(after[1].x - after[0].x, after[1].y - after[0].y);
            if (oldDistance < 1) return;
            const midpoint = { x: (after[0].x + after[1].x) / 2, y: (after[0].y + after[1].y) / 2 };
            const oldMidpoint = {
              x: (before[0].x + before[1].x) / 2,
              y: (before[0].y + before[1].y) / 2,
            };
            const rect = stage.current!.getBoundingClientRect();
            let localX = midpoint.x - rect.left;
            if (config.mode === 'side' && localX > panel.width) localX -= panel.width + 1;
            updateView((view) => {
              const oldScale = scaleFor(view, panel, bounds, dpr);
              const moved = panBy(
                view,
                { x: midpoint.x - oldMidpoint.x, y: midpoint.y - oldMidpoint.y },
                oldScale,
              );
              return zoomAt(
                moved,
                oldScale,
                (oldScale * dpr * distance) / oldDistance,
                { x: localX - panel.width / 2, y: midpoint.y - rect.top - panel.height / 2 },
                dpr,
                panel,
              );
            });
          } else
            updateView((view) =>
              panBy(
                view,
                { x: next.x - old.x, y: next.y - old.y },
                scaleFor(view, panel, bounds, dpr),
              ),
            );
        }}
        onPointerUp={(event) => {
          pointers.current.delete(event.pointerId);
          setPanning(pointers.current.size > 0);
        }}
        onPointerCancel={(event) => {
          pointers.current.delete(event.pointerId);
          setPanning(pointers.current.size > 0);
        }}
        onLostPointerCapture={(event) => {
          pointers.current.delete(event.pointerId);
          setPanning(pointers.current.size > 0);
        }}
      >
        {config.mode === 'split' ? (
          <>
            <div
              className="image-panel split-layer"
              style={{ clipPath: `inset(0 ${(1 - config.divider) * 100}% 0 0)` }}
            >
              {layer(a, 'A')}
            </div>
            <div
              className="image-panel split-layer"
              style={{ clipPath: `inset(0 0 0 ${config.divider * 100}%)` }}
            >
              {layer(b, 'B')}
            </div>
            <div
              className="divider"
              role="slider"
              aria-label="Comparison divider"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(config.divider * 100)}
              tabIndex={0}
              style={{ left: `clamp(18px, ${config.divider * 100}%, calc(100% - 18px))` }}
              onPointerDown={(event) => {
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                setDivider(event.clientX);
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  setDivider(event.clientX);
              }}
              onKeyDown={(event) => {
                if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                  event.preventDefault();
                  event.stopPropagation();
                  onChange((previous) => ({
                    ...previous,
                    divider:
                      event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? 1
                          : clamp(
                              previous.divider +
                                (event.key === 'ArrowLeft' ? -0.01 : 0.01) *
                                  (event.shiftKey ? 10 : 1),
                              0,
                              1,
                            ),
                  }));
                }
              }}
            >
              <span className="divider-handle" aria-hidden="true">
                ‹<span />›
              </span>
            </div>
          </>
        ) : (
          <div className="side-panels">
            <div className="image-panel">{layer(a, 'A')}</div>
            <div className="image-panel">{layer(b, 'B')}</div>
          </div>
        )}
        <span className="image-badge badge-a">
          <b>A</b>
          {a.label}
        </span>
        <span className="image-badge badge-b">
          <b>B</b>
          {b.label}
        </span>
        {(a.width !== b.width || a.height !== b.height) && (
          <div className="alignment-warning" role="status">
            Different dimensions · aligned at the top left, without resizing
          </div>
        )}
        <div className="inspection-toolbar" onDoubleClick={(event) => event.stopPropagation()}>
          <button
            className={config.view.zoom === null ? 'selected' : ''}
            onClick={() => setZoom(null)}
            title="Fit both images (0)"
          >
            Fit
          </button>
          {[1, 2, 4].map((zoom) => (
            <button
              key={zoom}
              className={config.view.zoom === zoom ? 'selected' : ''}
              onClick={() => setZoom(zoom)}
              title={
                zoom === 1
                  ? 'One source pixel per physical screen pixel (1)'
                  : `${zoom * 100}% source-pixel zoom (${zoom})`
              }
            >
              {zoom * 100}%
            </button>
          ))}
          <span className="toolbar-separator" />
          <button
            className="icon-button"
            aria-label="Zoom out"
            onClick={() => setZoom(clamp((scale * dpr) / 1.25, 0.025, 16))}
          >
            <Minus size={15} />
          </button>
          <output className="zoom-readout" aria-label="Current zoom">
            {config.view.zoom === null
              ? `${Math.round(scale * dpr * 100)}% fit`
              : `${Math.round(config.view.zoom * 100)}%${config.view.zoom === 1 ? ' · 1:1' : ''}`}
          </output>
          <button
            className="icon-button"
            aria-label="Zoom in"
            onClick={() => setZoom(clamp(scale * dpr * 1.25, 0.025, 16))}
          >
            <Plus size={15} />
          </button>
          <span className="toolbar-separator" />
          <button
            className="icon-button"
            aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            title="Fullscreen (F)"
            onClick={() => void toggleFullscreen()}
          >
            {fullscreen ? <Shrink size={16} /> : <Expand size={16} />}
          </button>
          <button
            className="icon-button"
            aria-label="Comparison details"
            title="Comparison details"
            onClick={onMetadata}
          >
            <Info size={16} />
          </button>
          <button
            className="icon-button"
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
            onClick={onHelp}
          >
            <Keyboard size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}
