import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { clamp } from '../lib/geometry';

const presets = [1, 2, 4, 6];
type FocusTarget = 'first' | 'last' | 'selected';

export function PhoneZoomMenu({
  zoom,
  onZoom,
  onOpenChange,
}: {
  zoom: number | null;
  onZoom: (zoom: number) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef<FocusTarget | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const label = zoom === null ? 'Fit' : `${Math.round(zoom * 100)}%`;

  useLayoutEffect(() => {
    if (!open) return;
    const button = trigger.current!;
    const popup = menu.current!;
    const app = button.closest('.app')!;
    let frame = 0;
    let lastBounds = '';
    const place = () => {
      const anchor = button.getBoundingClientRect();
      const viewport = window.visualViewport;
      const x = viewport?.offsetLeft ?? 0;
      const y = viewport?.offsetTop ?? 0;
      const root = document.documentElement;
      const style = getComputedStyle(app);
      const inset = (side: string) =>
        parseFloat(style.getPropertyValue(`--comparison-safe-${side}`)) || 0;
      const gap = 6;
      const left = Math.max(x, inset('left')) + gap;
      const top = Math.max(y, inset('top')) + gap;
      const right =
        Math.min(x + (viewport?.width ?? root.clientWidth), root.clientWidth - inset('right')) -
        gap;
      const bottom =
        Math.min(y + (viewport?.height ?? innerHeight), innerHeight - inset('bottom')) - gap;
      const bounds = [left, top, right, bottom, anchor.left, anchor.top, anchor.bottom].join(':');
      if (bounds !== lastBounds) {
        lastBounds = bounds;
        popup.style.maxWidth = `${Math.max(0, right - left)}px`;
        const height = popup.scrollHeight + popup.offsetHeight - popup.clientHeight;
        const aboveEnd = Math.min(anchor.top - gap, bottom);
        const belowStart = Math.max(anchor.bottom + gap, top);
        const above = Math.max(0, aboveEnd - top);
        const below = Math.max(0, bottom - belowStart);
        const opensUp = above >= height || above >= below;
        popup.style.maxHeight = `${opensUp ? above : below}px`;
        const rect = popup.getBoundingClientRect();
        popup.style.left = `${clamp(anchor.left, left, Math.max(left, right - rect.width))}px`;
        popup.style.top = `${opensUp ? aboveEnd - rect.height : belowStart}px`;
      }
      // While open, follow layout changes that move the toolbar without resizing it.
      frame = requestAnimationFrame(place);
    };
    place();
    if (focusOnOpen.current) focusItem(popup, focusOnOpen.current);
    focusOnOpen.current = undefined;
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useLayoutEffect(() => () => onOpenChange?.(false), [onOpenChange]);

  function dismiss(event: KeyboardEvent) {
    event.preventDefault();
    event.stopPropagation();
    menu.current!.hidePopover();
    trigger.current!.focus({ preventScroll: true });
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="phone-zoom-trigger"
        aria-label="Zoom preset"
        aria-describedby={`${id}-value`}
        aria-haspopup="menu"
        aria-controls={id}
        aria-expanded={open}
        popoverTarget={id}
        onClick={(event) => {
          if (event.detail === 0 && !open) focusOnOpen.current ??= 'selected';
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) dismiss(event);
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          const target = event.key === 'ArrowDown' ? 'first' : 'last';
          if (open) focusItem(menu.current!, target);
          else {
            focusOnOpen.current = target;
            event.currentTarget.click();
          }
        }}
      >
        <span id={`${id}-value`}>{label}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      <div
        id={id}
        ref={menu}
        className="zoom-presets"
        popover="auto"
        role="menu"
        aria-label="Zoom presets"
        data-open={open ? '' : undefined}
        onToggle={(event) => {
          const next = event.newState === 'open';
          setOpen(next);
          onOpenChange?.(next);
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (
            next &&
            next !== trigger.current &&
            !event.currentTarget.contains(next) &&
            event.currentTarget.matches(':popover-open')
          )
            event.currentTarget.hidePopover();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') dismiss(event);
          if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            focusItem(event.currentTarget, event.key === 'Home' ? 'first' : 'last');
          }
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          const items = Array.from(event.currentTarget.querySelectorAll('button'));
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          const step = event.key === 'ArrowDown' ? 1 : -1;
          items[(index + step + items.length) % items.length].focus();
        }}
      >
        {presets.map((preset) => (
          <button
            key={preset}
            type="button"
            role="menuitemradio"
            aria-checked={zoom === preset}
            tabIndex={-1}
            onClick={(event) => {
              menu.current!.hidePopover();
              if (event.detail === 0) trigger.current!.focus({ preventScroll: true });
              onZoom(preset);
            }}
          >
            {preset * 100}%
          </button>
        ))}
      </div>
    </>
  );
}

function focusItem(menu: HTMLElement, target: FocusTarget) {
  const items = menu.querySelectorAll('button');
  const selected = menu.querySelector<HTMLButtonElement>('[aria-checked="true"]');
  (target === 'last'
    ? items[items.length - 1]
    : (target === 'selected' && selected) || items[0]
  ).focus();
}
