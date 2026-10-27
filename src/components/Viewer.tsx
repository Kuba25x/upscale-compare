import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import { snapshotContacts, sameContacts, samePositions } from '../lib/contact-snapshot';
import type { Point } from '../lib/geometry';
import { Expand, Info, Keyboard, Minus, Plus, Shrink } from 'lucide-react';
import type { Config, LocalImage, View } from '../../shared/model';
import {
  gestureDiagnostics,
  observeGestureEvents,
  diagnosticViewport,
  type DiagnosticData,
} from '../lib/gesture-diagnostics';
import { clamp, originFor, panBy, pinchAt, scaleFor, zoomAt } from '../lib/geometry';

interface Props {
  images: LocalImage[];
  config: Config;
  onChange: (update: (previous: Config) => Config) => void;
  onMetadata: () => void;
  onHelp: () => void;
}
export function Viewer({ images, config, onChange, onMetadata, onHelp }: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1, height: 1, x: 0, y: 0 });
  const [dpr, setDpr] = useState(window.devicePixelRatio || 1);
  const [fullscreen, setFullscreen] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number; pointerType: string }>());
  const touchContacts = useRef(new Map<number, Point>());
  const nativeTouchSeen = useRef(false);
  const pinchRightPanel = useRef<boolean | null>(null);
  const touchPinch = useRef(false);
  const [panning, setPanning] = useState(false);
  const endPointer = useCallback((pointerId: number, reason = 'pointerup') => {
    pointers.current.delete(pointerId);
    if (pointers.current.size < 2 && touchContacts.current.size < 2) pinchRightPanel.current = null;
    const element = stage.current;
    if (element?.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
    if (gestureDiagnostics?.recording)
      gestureDiagnostics.record('pointer-end', {
        pointerId,
        reason,
        remainingIds: [...pointers.current.keys()],
      });
    setPanning(
      touchContacts.current.size > 0 ||
        [...pointers.current.values()].some(
          (point) => !nativeTouchSeen.current || point.pointerType !== 'touch',
        ),
    );
  }, []);
  const cancelPanning = useCallback(() => {
    const element = stage.current;
    for (const pointerId of pointers.current.keys()) {
      if (element?.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
    }
    pointers.current.clear();
    touchContacts.current.clear();
    pinchRightPanel.current = null;
    if (gestureDiagnostics?.recording) gestureDiagnostics.record('cancel-all', {});
    setPanning(false);
  }, []);
  useEffect(() => {
    const visibilityChange = () => {
      if (document.hidden) cancelPanning();
    };
    window.addEventListener('blur', cancelPanning);
    document.addEventListener('visibilitychange', visibilityChange);
    const element = stage.current;
    return () => {
      window.removeEventListener('blur', cancelPanning);
      document.removeEventListener('visibilitychange', visibilityChange);
      for (const pointerId of pointers.current.keys()) {
        if (element?.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
      }
      pointers.current.clear();
      touchContacts.current.clear();
    };
  }, [cancelPanning]);
  const [a, b] = config.selected.map((index) => images[index]);
  const bounds = { width: Math.max(a.width, b.width), height: Math.max(a.height, b.height) };
  const panel = {
    width: config.mode === 'side' ? (size.width - 1) / 2 : size.width,
    height: size.height,
  };
  const scale = scaleFor(config.view, panel, bounds, dpr);
  const latest = useRef({ config, panel, bounds, dpr });
  latest.current = { config, panel, bounds, dpr };
  const diagnosticFrame = useRef<DiagnosticData>({});
  const diagnosticCommit = useRef(0);
  const diagnosticPointers = useCallback(() => {
    const element = stage.current;
    const divider = element?.querySelector('[role="slider"]');
    const activePointers = [...pointers.current].slice(0, 16).map(([id, point]) => ({
      id,
      x: point.x,
      y: point.y,
      stageCapture: element?.hasPointerCapture(id) ?? false,
      dividerCapture: divider?.hasPointerCapture(id) ?? false,
    }));
    return {
      activePointers,
      touchContacts: [...touchContacts.current].map(([id, point]) => ({ id, ...point })),
      nativeTouchSeen: nativeTouchSeen.current,
      touchDistance:
        touchContacts.current.size < 2
          ? null
          : (() => {
              const [first, second] = [...touchContacts.current.values()];
              return Math.hypot(second.x - first.x, second.y - first.y);
            })(),
      cachedDistance:
        activePointers.length < 2
          ? null
          : Math.hypot(
              activePointers[1].x - activePointers[0].x,
              activePointers[1].y - activePointers[0].y,
            ),
      lockedRightPanel: pinchRightPanel.current,
      touchPinch: touchPinch.current,
    };
  }, []);
  useEffect(() => {
    if (!gestureDiagnostics) return;
    const element = stage.current!;
    const removeProvider = gestureDiagnostics.setProvider(() => ({
      frame: diagnosticFrame.current,
      ...diagnosticPointers(),
      viewport: diagnosticViewport(),
      touchAction: getComputedStyle(element).touchAction,
    }));
    const removeEvents = observeGestureEvents(element, gestureDiagnostics, diagnosticPointers);
    return () => {
      removeEvents();
      removeProvider();
    };
  }, [diagnosticPointers]);
  useEffect(() => {
    if (!gestureDiagnostics) return;
    const frame = {
      commitIndex: ++diagnosticCommit.current,
      mode: config.mode,
      divider: config.divider,
      view: { zoom: config.view.zoom, center: { ...config.view.center } },
      scale,
      dpr,
      stage: { ...size },
      panel: { ...panel },
      bounds: { ...bounds },
      imageDimensions: [a, b].map((image) => ({ width: image.width, height: image.height })),
      renderedStyles: [
        ...stage.current!.querySelectorAll<HTMLImageElement>('.comparison-image'),
      ].map((image, index) => ({
        side: index === 0 ? 'A' : 'B',
        width: image.style.width,
        height: image.style.height,
        transform: image.style.transform,
        imageRendering: image.style.imageRendering,
      })),
    };
    diagnosticFrame.current = frame;
    if (gestureDiagnostics.recording) gestureDiagnostics.record('commit', frame);
  }, [config, size, dpr, images]);

  useEffect(() => {
    const resize = () => {
      if (stage.current) {
        const rect = stage.current.getBoundingClientRect();
        setSize({ width: rect.width, height: rect.height, x: rect.left, y: rect.top });
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
    const element = stage.current!;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const diagnosticEvent = gestureDiagnostics?.eventId(event);
      if (gestureDiagnostics?.recording)
        gestureDiagnostics.record('wheel-handler', {
          eventId: diagnosticEvent,
          ignored:
            touchPinch.current && (pointers.current.size > 0 || touchContacts.current.size > 0),
        });
      // A touch pinch owns zoom until its contacts end; do not apply a second stream.
      if (touchPinch.current && (pointers.current.size > 0 || touchContacts.current.size > 0))
        return;
      const {
        config: current,
        panel: currentPanel,
        bounds: currentBounds,
        dpr: ratio,
      } = latest.current;
      const rect = stage.current!.getBoundingClientRect();
      let x = event.clientX - rect.left;
      const rightPanel = current.mode === 'side' && x > currentPanel.width;
      if (rightPanel) x -= currentPanel.width + 1;
      const offset = {
        x: x - currentPanel.width / 2,
        y: event.clientY - rect.top - currentPanel.height / 2,
      };
      onChange((previous) => {
        const oldScale = scaleFor(previous.view, currentPanel, currentBounds, ratio);
        const nextView = zoomAt(
          previous.view,
          oldScale,
          oldScale * ratio * Math.exp(-event.deltaY * 0.0015),
          offset,
          ratio,
          currentPanel,
          { x: rect.left + (rightPanel ? currentPanel.width + 1 : 0), y: rect.top },
        );
        if (gestureDiagnostics?.recording)
          gestureDiagnostics.record('calculation', {
            eventId: diagnosticEvent,
            source: 'wheel',
            before: previous.view,
            after: nextView,
            oldScale,
            requestedZoom: oldScale * ratio * Math.exp(-event.deltaY * 0.0015),
            deltaY: event.deltaY,
            offset,
            dpr: ratio,
            panel: currentPanel,
          });
        return { ...previous, view: nextView };
      });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
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
  const moveContacts = (
    before: Point[],
    after: Point[],
    diagnosticEvent: number | undefined,
    diagnosticIds: number[] | undefined,
    input: 'pointer' | 'touch',
  ) => {
    if (!before.length || !after.length) return;
    if (after.length >= 2) {
      const oldDistance = Math.hypot(before[1].x - before[0].x, before[1].y - before[0].y);
      const distance = Math.hypot(after[1].x - after[0].x, after[1].y - after[0].y);
      if (oldDistance < 1) {
        if (gestureDiagnostics?.recording)
          gestureDiagnostics.record('ignored-move', {
            eventId: diagnosticEvent,
            reason: 'short-span',
            oldDistance,
            distance,
          });
        return;
      }
      const midpoint = { x: (after[0].x + after[1].x) / 2, y: (after[0].y + after[1].y) / 2 };
      const oldMidpoint = {
        x: (before[0].x + before[1].x) / 2,
        y: (before[0].y + before[1].y) / 2,
      };
      const rect = stage.current!.getBoundingClientRect();
      // Keep the panel selected when the second contact joined, even across the seam.
      const panelOffset = config.mode === 'side' && pinchRightPanel.current ? panel.width + 1 : 0;
      const localX = midpoint.x - rect.left - panelOffset;
      updateView((view) => {
        const oldScale = scaleFor(view, panel, bounds, dpr);
        const nextView = pinchAt(
          view,
          oldScale,
          (oldScale * dpr * distance) / oldDistance,
          {
            x: oldMidpoint.x - rect.left - panelOffset - panel.width / 2,
            y: oldMidpoint.y - rect.top - panel.height / 2,
          },
          { x: localX - panel.width / 2, y: midpoint.y - rect.top - panel.height / 2 },
          dpr,
          panel,
          { x: rect.left + panelOffset, y: rect.top },
        );
        if (gestureDiagnostics?.recording)
          gestureDiagnostics.record('calculation', {
            eventId: diagnosticEvent,
            source: 'pinch',
            input,
            before: view,
            after: nextView,
            oldScale,
            requestedZoom: (oldScale * dpr * distance) / oldDistance,
            oldDistance,
            distance,
            ratio: distance / oldDistance,
            oldMidpoint,
            midpoint,
            beforePointers: before,
            afterPointers: after,
            pointerIds: diagnosticIds,
            panelOffset,
            dpr,
            panel: { ...panel },
            stageRect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
          });
        return nextView;
      });
    } else
      updateView((view) => {
        const currentScale = scaleFor(view, panel, bounds, dpr);
        const delta = { x: after[0].x - before[0].x, y: after[0].y - before[0].y };
        const nextView = panBy(view, delta, currentScale);
        if (gestureDiagnostics?.recording)
          gestureDiagnostics.record('calculation', {
            eventId: diagnosticEvent,
            source: 'pan',
            input,
            before: view,
            after: nextView,
            oldScale: currentScale,
            delta,
            previousPoint: before[0],
            nextPoint: after[0],
          });
        return nextView;
      });
  };
  const nativeTouches = (
    event: ReactTouchEvent<HTMLDivElement>,
    phase: 'start' | 'move' | 'end',
  ) => {
    const previous = touchContacts.current;
    if (phase !== 'start' && previous.size === 0) return;
    const eligible = Array.from(event.touches).filter(
      (contact) =>
        contact.target instanceof Element &&
        event.currentTarget.contains(contact.target) &&
        !contact.target.closest('button'),
    );
    if (
      phase === 'start' &&
      previous.size === 0 &&
      (eligible.length === 0 ||
        (eligible.length === 1 && (eligible[0].target as Element).closest('[role="slider"]')))
    )
      return;
    const next = snapshotContacts(
      previous,
      eligible.map((contact) => ({
        id: contact.identifier,
        x: contact.clientX,
        y: contact.clientY,
      })),
    );
    nativeTouchSeen.current = true;
    if (phase === 'start' && previous.size === 0) touchPinch.current = false;
    const previousPair = [...previous.keys()].slice(0, 2),
      nextPair = [...next.keys()].slice(0, 2);
    const pairChanged =
      previousPair.length !== nextPair.length ||
      previousPair.some((id, index) => id !== nextPair[index]);
    touchContacts.current = next;
    if (next.size < 2) pinchRightPanel.current = null;
    else {
      touchPinch.current = true;
      if (pairChanged) {
        const [first, second] = [...next.values()];
        const rect = event.currentTarget.getBoundingClientRect();
        pinchRightPanel.current =
          config.mode === 'side' && (first.x + second.x) / 2 - rect.left > panel.width;
      }
    }
    const diagnosticEvent = gestureDiagnostics?.eventId(event.nativeEvent);
    if (gestureDiagnostics?.recording)
      gestureDiagnostics.record('touch-snapshot-handler', {
        eventId: diagnosticEvent,
        phase,
        pairChanged,
        ...diagnosticPointers(),
      });
    // Only move on a complete, stable-identity frame. Contact changes rebase without motion.
    if (phase === 'move' && sameContacts(previous, next) && !samePositions(previous, next))
      moveContacts(
        [...previous.values()],
        [...next.values()],
        diagnosticEvent,
        gestureDiagnostics?.recording ? [...next.keys()] : undefined,
        'touch',
      );
    if (next.size === 0) {
      for (const [id, point] of [...pointers.current])
        if (point.pointerType === 'touch') endPointer(id, 'touch-ended');
    }
    setPanning(
      next.size > 0 ||
        [...pointers.current.values()].some((point) => point.pointerType !== 'touch'),
    );
  };
  const layer = (image: LocalImage, side: 'A' | 'B') => {
    const panelOffset = config.mode === 'side' && side === 'B' ? panel.width + 1 : 0;
    const origin = originFor(config.view, panel, scale, dpr, {
      x: size.x + panelOffset,
      y: size.y,
    });
    return (
      <img
        className="comparison-image"
        data-testid={`image-${side}`}
        src={image.url}
        alt={image.label}
        draggable={false}
        width={image.width}
        height={image.height}
        style={{
          left: 0,
          top: 0,
          transform: `translate(${origin.x + panelOffset}px, ${origin.y}px)`,
          width: image.width * scale,
          height: image.height * scale,
          imageRendering: config.view.zoom !== null && config.view.zoom >= 1 ? 'pixelated' : 'auto',
        }}
      />
    );
  };
  return (
    <div className="viewer-content">
      <div
        ref={stage}
        className={`stage ${panning ? 'panning' : ''}`}
        data-testid="stage"
        data-scale={scale}
        data-zoom={config.view.zoom ?? 'fit'}
        tabIndex={0}
        aria-label="Image comparison. Drag to pan, scroll to zoom."
        onDragStartCapture={(event) => event.preventDefault()}
        onDoubleClick={(event) => {
          if (gestureDiagnostics?.recording)
            gestureDiagnostics.record('double-click-handler', {
              eventId: gestureDiagnostics.eventId(event.nativeEvent),
              ignored: touchPinch.current,
              currentView: config.view,
              requestedZoom: config.view.zoom === 1 ? null : 1,
            });
          // Some input sequences can emit a compatibility double-click after touch-up.
          if (!touchPinch.current) setZoom(config.view.zoom === 1 ? null : 1);
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || (event.target as HTMLElement).closest('button,[role=slider]'))
            return;
          // Pointer capture does not suppress native selection or selection dragging.
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
          stage.current!.setPointerCapture(event.pointerId);
          if (pointers.current.size === 0 && touchContacts.current.size === 0)
            touchPinch.current = false;
          pointers.current.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
            pointerType: event.pointerType,
          });
          if (
            pointers.current.size === 2 &&
            !(event.pointerType === 'touch' && nativeTouchSeen.current)
          ) {
            touchPinch.current = true;
            const [first, second] = [...pointers.current.values()];
            const rect = event.currentTarget.getBoundingClientRect();
            pinchRightPanel.current =
              config.mode === 'side' && (first.x + second.x) / 2 - rect.left > panel.width;
          }
          if (gestureDiagnostics?.recording)
            gestureDiagnostics.record('pointer-down-handler', {
              eventId: gestureDiagnostics.eventId(event.nativeEvent),
              ...diagnosticPointers(),
            });
          setPanning(true);
        }}
        onPointerMove={(event) => {
          const diagnosticEvent = gestureDiagnostics?.eventId(event.nativeEvent);
          const old = pointers.current.get(event.pointerId);
          if (!old) {
            if (gestureDiagnostics?.recording)
              gestureDiagnostics.record('ignored-move', {
                eventId: diagnosticEvent,
                reason: 'untracked-pointer',
                pointerId: event.pointerId,
              });
            return;
          }
          if (
            !event.currentTarget.hasPointerCapture(event.pointerId) ||
            (event.pointerType === 'mouse' && (event.buttons & 1) === 0)
          ) {
            if (gestureDiagnostics?.recording)
              gestureDiagnostics.record('ignored-move', {
                eventId: diagnosticEvent,
                reason: 'capture-or-buttons',
                pointerId: event.pointerId,
                captured: event.currentTarget.hasPointerCapture(event.pointerId),
                buttons: event.buttons,
              });
            endPointer(event.pointerId, 'capture-or-buttons');
            return;
          }
          const before = [...pointers.current.values()];
          const diagnosticIds = gestureDiagnostics?.recording
            ? [...pointers.current.keys()]
            : undefined;
          const next = { x: event.clientX, y: event.clientY, pointerType: event.pointerType };
          pointers.current.set(event.pointerId, next);
          if (event.pointerType === 'touch' && nativeTouchSeen.current) {
            if (gestureDiagnostics?.recording)
              gestureDiagnostics.record('pointer-observation', {
                eventId: diagnosticEvent,
                reason: 'touch-snapshot-owns-motion',
                pointerId: event.pointerId,
              });
            return;
          }
          moveContacts(
            before,
            [...pointers.current.values()],
            diagnosticEvent,
            diagnosticIds,
            'pointer',
          );
        }}
        onTouchStart={(event) => nativeTouches(event, 'start')}
        onTouchMove={(event) => nativeTouches(event, 'move')}
        onTouchEnd={(event) => nativeTouches(event, 'end')}
        onTouchCancel={(event) => nativeTouches(event, 'end')}
        onPointerUp={(event) => endPointer(event.pointerId)}
        onPointerCancel={(event) => endPointer(event.pointerId, 'pointercancel')}
        onLostPointerCapture={(event) => {
          if (event.target === event.currentTarget)
            endPointer(event.pointerId, 'lostpointercapture');
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
                if (event.pointerType === 'touch' && touchContacts.current.size > 0) {
                  event.preventDefault();
                  event.stopPropagation();
                  return;
                }
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                // Keep pointer gestures in the viewer; Tab gives the slider keyboard focus.
                stage.current?.focus({ preventScroll: true });
                event.currentTarget.setPointerCapture(event.pointerId);
                setDivider(event.clientX);
              }}
              onPointerMove={(event) => {
                if (event.pointerType === 'touch' && touchContacts.current.size > 0) return;
                if (event.pointerType === 'mouse' && (event.buttons & 1) === 0) {
                  if (event.currentTarget.hasPointerCapture(event.pointerId))
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  return;
                }
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
            <div
              className="image-panel side-layer"
              style={{ clipPath: `inset(0 ${((panel.width + 1) / size.width) * 100}% 0 0)` }}
            >
              {layer(a, 'A')}
            </div>
            <div
              className="image-panel side-layer"
              style={{ clipPath: `inset(0 0 0 ${((panel.width + 1) / size.width) * 100}%)` }}
            >
              {layer(b, 'B')}
            </div>
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
