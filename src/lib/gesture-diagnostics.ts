import { DEMO_MODE } from './config';

export const DIAGNOSTIC_LIMIT = 8000;
export function diagnosticsAllowed(dev: boolean, demo: boolean, search: string): boolean {
  return dev && demo && new URLSearchParams(search).get('diagnostics') === '1';
}
export type DiagnosticData = Record<string, unknown>;
export interface DiagnosticEntry {
  sequence: number;
  elapsedMs: number;
  kind: string;
  data: DiagnosticData;
}
export function browserIdentity(ua: string) {
  const match = /(Firefox|Edg|Chrome)\/([\d.]+)/.exec(ua);
  return { name: match?.[1] || 'Other', version: match?.[2] || 'unknown' };
}

// This recorder accepts only explicitly constructed diagnostic data, never DOM/events/files.
export class GestureRecorder {
  recording = false;
  private entries: DiagnosticEntry[] = [];
  private dropped = 0;
  private startTime = 0;
  private sequence = 0;
  private eventSequence = 0;
  private eventIds = new WeakMap<Event, number>();
  private provider: (() => DiagnosticData) | undefined;
  private initial: DiagnosticData = {};
  private final: DiagnosticData = {};
  constructor(
    private limit = DIAGNOSTIC_LIMIT,
    private clock = () => performance.now(),
  ) {}
  setProvider(provider: () => DiagnosticData) {
    this.provider = provider;
    return () => {
      if (this.provider === provider) this.provider = undefined;
    };
  }
  start() {
    this.clear();
    this.startTime = this.clock();
    this.initial = this.provider?.() || {};
    this.recording = true;
    this.record('start', this.initial);
  }
  stop() {
    if (this.recording) {
      this.final = this.provider?.() || {};
      this.record('stop', this.final);
    }
    this.recording = false;
  }
  clear() {
    this.recording = false;
    this.entries = [];
    this.initial = {};
    this.final = {};
    this.dropped = this.sequence = this.eventSequence = 0;
    this.eventIds = new WeakMap();
  }
  eventId(event: Event): number | undefined {
    if (!this.recording) return;
    let id = this.eventIds.get(event);
    if (id === undefined) {
      id = ++this.eventSequence;
      this.eventIds.set(event, id);
    }
    return id;
  }
  record(kind: string, data: DiagnosticData) {
    if (!this.recording) return;
    if (this.entries.length >= this.limit) {
      this.dropped++;
      return;
    }
    this.entries.push({
      sequence: ++this.sequence,
      elapsedMs: this.clock() - this.startTime,
      kind,
      data,
    });
  }
  export() {
    return JSON.stringify(
      {
        format: 'upscale-compare-gesture-log',
        version: 1,
        browser: browserIdentity(typeof navigator === 'undefined' ? '' : navigator.userAgent),
        limits: { maxEntries: this.limit, dropped: this.dropped, truncated: this.dropped > 0 },
        initial: this.initial,
        final: this.recording ? this.provider?.() || {} : this.final,
        entries: this.entries,
      },
      (_key, value) =>
        typeof value === 'number' && !Number.isFinite(value) ? String(value) : value,
    );
  }
  get count() {
    return this.entries.length;
  }
  get ready() {
    return Boolean(this.provider);
  }
  get recordedMode() {
    const frame = this.initial.frame as { mode?: string } | undefined;
    return frame?.mode === 'side' ? 'side-by-side' : 'split';
  }
  get truncated() {
    return this.dropped > 0;
  }
}

// No recorder, event listeners or UI in production builds or ordinary development sessions.
export const gestureDiagnostics = diagnosticsAllowed(
  import.meta.env.DEV,
  DEMO_MODE,
  typeof location === 'undefined' ? '' : location.search,
)
  ? new GestureRecorder()
  : null;

export function diagnosticViewport() {
  const v = window.visualViewport;
  return {
    scale: v?.scale ?? 1,
    width: v?.width,
    height: v?.height,
    offsetLeft: v?.offsetLeft,
    offsetTop: v?.offsetTop,
    pageLeft: v?.pageLeft,
    pageTop: v?.pageTop,
    dpr: window.devicePixelRatio,
  };
}
function targetKind(target: EventTarget | null): string {
  if (!(target instanceof Element)) return 'other';
  if (target.closest('[role="slider"]')) return 'divider';
  if (target.closest('button')) return 'viewer-control';
  return 'image-area';
}
function touches(list: TouchList) {
  return Array.from(list)
    .slice(0, 10)
    .map((t) => ({ id: t.identifier, x: t.clientX, y: t.clientY, pageX: t.pageX, pageY: t.pageY }));
}

export function observeGestureEvents(
  stage: HTMLElement,
  recorder: GestureRecorder,
  pointerState: () => DiagnosticData,
) {
  const removers: Array<() => void> = [];
  const listen = (target: EventTarget, type: string, callback: EventListener) => {
    const options = { capture: true, passive: true };
    target.addEventListener(type, callback, options);
    removers.push(() => target.removeEventListener(type, callback, options));
  };
  const native = (event: Event) => {
    if (!recorder.recording) return;
    const state = pointerState();
    const inside = event.target instanceof Node && stage.contains(event.target);
    // Keep outside contacts/capture transitions: retargeting is part of the investigation.
    // Unpressed mouse hover outside the viewer is unrelated to touch navigation.
    if (
      !inside &&
      event.type === 'pointermove' &&
      (event as PointerEvent).pointerType === 'mouse' &&
      (event as PointerEvent).buttons === 0 &&
      !(Array.isArray(state.activePointers) && state.activePointers.length)
    )
      return;
    const eventId = recorder.eventId(event);
    const data: DiagnosticData = {
      eventId,
      type: event.type,
      eventTimeStamp: event.timeStamp,
      trusted: event.isTrusted,
      cancelable: event.cancelable,
      defaultPrevented: event.defaultPrevented,
      target: inside ? targetKind(event.target) : 'outside-viewer',
      viewport: diagnosticViewport(),
      ...state,
    };
    if (typeof PointerEvent !== 'undefined' && event instanceof PointerEvent)
      Object.assign(data, {
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        primary: event.isPrimary,
        x: event.clientX,
        y: event.clientY,
        pageX: event.pageX,
        pageY: event.pageY,
        button: event.button,
        buttons: event.buttons,
        pressure: event.pressure,
        coalescedCount: event.getCoalescedEvents?.().length ?? 0,
        coalesced: event
          .getCoalescedEvents?.()
          .slice(-8)
          .map((point) => ({
            x: point.clientX,
            y: point.clientY,
            timeStamp: point.timeStamp,
          })),
        eventCapture: {
          stage: stage.hasPointerCapture(event.pointerId),
          divider:
            stage.querySelector('[role="slider"]')?.hasPointerCapture(event.pointerId) ?? false,
        },
      });
    if (typeof TouchEvent !== 'undefined' && event instanceof TouchEvent)
      Object.assign(data, {
        touches: touches(event.touches),
        changedTouches: touches(event.changedTouches),
        targetTouches: touches(event.targetTouches),
      });
    if (event instanceof MouseEvent)
      Object.assign(data, {
        x: event.clientX,
        y: event.clientY,
        button: event.button,
        buttons: event.buttons,
        detail: event.detail,
        ctrlKey: event.ctrlKey,
      });
    if (event instanceof WheelEvent)
      Object.assign(data, {
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaZ: event.deltaZ,
        deltaMode: event.deltaMode,
      });
    recorder.record('native', data);
    // Observe the outcome after delegated React handlers; never cancel or dispatch input.
    if (event.type !== 'pointermove' && event.type !== 'touchmove')
      queueMicrotask(() => {
        recorder.record('native-after', {
          eventId,
          type: event.type,
          defaultPrevented: event.defaultPrevented,
          ...pointerState(),
        });
      });
  };
  for (const type of [
    'pointerdown',
    'pointermove',
    'pointerup',
    'pointercancel',
    'gotpointercapture',
    'lostpointercapture',
    'touchstart',
    'touchmove',
    'touchend',
    'touchcancel',
    'wheel',
    'dblclick',
  ])
    listen(document, type, native);
  for (const type of ['resize', 'scroll'])
    if (window.visualViewport)
      listen(window.visualViewport, type, () => {
        if (recorder.recording)
          recorder.record('visual-viewport', { type, ...diagnosticViewport() });
      });
  for (const type of ['resize', 'blur', 'focus', 'orientationchange'])
    listen(window, type, (event) => {
      if (event.target !== window) return;
      if (recorder.recording) recorder.record('window', { type, ...diagnosticViewport() });
    });
  listen(document, 'visibilitychange', () => {
    if (recorder.recording) recorder.record('visibility', { hidden: document.hidden });
  });
  return () => removers.forEach((remove) => remove());
}
