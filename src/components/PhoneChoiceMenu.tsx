import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useAnchoredPopover, type PopoverChange } from './useAnchoredPopover';

type FocusTarget = 'first' | 'last' | 'selected';

export function PhoneChoiceMenu({
  label,
  menuLabel,
  value,
  badge,
  choices,
  selected,
  triggerClass,
  menuClass,
  onSelect,
  onOpenChange,
}: {
  label: string;
  menuLabel: string;
  value: ReactNode;
  badge?: ReactNode;
  choices: { value: number; label: string }[];
  selected: number | null;
  triggerClass: string;
  menuClass: string;
  onSelect: (value: number) => void;
  onOpenChange?: PopoverChange;
}) {
  const { isOpen, dismiss, focusWhenOpen, triggerProps, popupProps } = useAnchoredPopover(
    'above',
    onOpenChange,
  );
  const valueId = `${popupProps.id}-value`;

  return (
    <>
      <button
        {...triggerProps}
        type="button"
        className={triggerClass}
        aria-label={label}
        aria-describedby={valueId}
        aria-haspopup="menu"
        onClick={(event) => {
          if (event.detail === 0 && !isOpen())
            focusWhenOpen((popup) => focusItem(popup, 'selected'));
        }}
        onKeyDown={(event) => {
          triggerProps.onKeyDown(event);
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          if (!isOpen()) event.currentTarget.click();
          focusWhenOpen((popup) => focusItem(popup, event.key === 'ArrowDown' ? 'first' : 'last'));
        }}
      >
        {badge}
        <span id={valueId} className="phone-choice-value">
          {value}
        </span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      <div
        {...popupProps}
        className={`phone-popover phone-choice-menu ${menuClass}`}
        role="menu"
        aria-label={menuLabel}
        onPointerDown={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          popupProps.onKeyDown(event);
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
        {choices.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            role="menuitemradio"
            aria-checked={selected === value}
            tabIndex={-1}
            onClick={(event) => {
              dismiss(event.detail === 0);
              onSelect(value);
            }}
          >
            <span>{label}</span>
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
