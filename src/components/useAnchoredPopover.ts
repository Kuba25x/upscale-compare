import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { clamp } from '../lib/geometry';

export type PopoverChange = (id: string, open: boolean) => void;

export function useAnchoredPopover(
  placement: 'above' | 'below',
  onOpenChange?: PopoverChange,
  enabled = true,
) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<((popup: HTMLDivElement) => void) | undefined>(undefined);
  const [open, setOpen] = useState(false);

  function focusWhenOpen(action: (popup: HTMLDivElement) => void) {
    pendingFocus.current = action;
    if (isOpen() && popup.current?.hasAttribute('data-open')) applyPendingFocus(popup.current);
  }

  function applyPendingFocus(element: HTMLDivElement) {
    pendingFocus.current?.(element);
    pendingFocus.current = undefined;
  }

  function isOpen() {
    return popup.current?.matches(':popover-open') ?? false;
  }

  function dismiss(restoreFocus = false) {
    popup.current?.hidePopover();
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }

  function escape(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !isOpen()) return;
    event.preventDefault();
    event.stopPropagation();
    dismiss(true);
  }

  useLayoutEffect(() => {
    if (!open || !enabled) return;
    const button = trigger.current!;
    const element = popup.current!;
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
      const height = element.scrollHeight + element.offsetHeight - element.clientHeight;
      const bounds = [
        left,
        top,
        right,
        bottom,
        anchor.left,
        anchor.top,
        anchor.bottom,
        height,
      ].join(':');
      if (bounds !== lastBounds) {
        lastBounds = bounds;
        element.style.maxWidth = `${Math.max(0, right - left)}px`;
        const aboveEnd = Math.min(anchor.top - gap, bottom);
        const belowStart = Math.max(anchor.bottom + gap, top);
        const above = Math.max(0, aboveEnd - top);
        const below = Math.max(0, bottom - belowStart);
        const opensUp =
          placement === 'above'
            ? above >= height || above >= below
            : below < height && above > below;
        element.style.maxHeight = `${opensUp ? above : below}px`;
        const rect = element.getBoundingClientRect();
        element.style.left = `${clamp(anchor.left, left, Math.max(left, right - rect.width))}px`;
        element.style.top = `${opensUp ? aboveEnd - rect.height : belowStart}px`;
      }
      // The anchor can move without resizing when the surrounding layout changes.
      frame = requestAnimationFrame(place);
    };
    place();
    applyPendingFocus(element);
    return () => cancelAnimationFrame(frame);
  }, [open, placement, enabled]);

  useLayoutEffect(() => {
    if (!enabled) setOpen(false);
    return () => onOpenChange?.(id, false);
  }, [enabled, id, onOpenChange]);

  return {
    isOpen,
    dismiss,
    focusWhenOpen,
    triggerProps: {
      ref: trigger,
      'aria-controls': id,
      'aria-expanded': open,
      popoverTarget: id,
      onKeyDown: escape,
    },
    popupProps: {
      id,
      ref: popup,
      popover: 'auto' as const,
      'data-open': open ? '' : undefined,
      onToggle(event: React.ToggleEvent<HTMLDivElement>) {
        if (event.target !== event.currentTarget) return;
        const next = event.newState === 'open';
        // A close and immediate reopen can arrive as one toggle.
        if (next && open) applyPendingFocus(event.currentTarget);
        if (!next) pendingFocus.current = undefined;
        setOpen(next);
        onOpenChange?.(id, next);
      },
      onBlur(event: React.FocusEvent<HTMLDivElement>) {
        const next = event.relatedTarget;
        if (next && next !== trigger.current && !event.currentTarget.contains(next) && isOpen())
          dismiss();
      },
      onKeyDown: escape,
    },
  };
}
