import { ChoiceMenu } from './ChoiceMenu';
import type { PopoverChange } from './useAnchoredPopover';

const presets = [1, 2, 4, 6].map((value) => ({ value, label: `${value * 100}%` }));

export function PhoneZoomMenu({
  zoom,
  description,
  onZoom,
  onOpenChange,
}: {
  zoom: number | null;
  description?: string;
  onZoom: (zoom: number) => void;
  onOpenChange?: PopoverChange;
}) {
  return (
    <ChoiceMenu
      label="Zoom preset"
      menuLabel="Zoom presets"
      value={zoom === null ? 'Fit' : `${Math.round(zoom * 100)}%`}
      valueDescription={description}
      choices={presets}
      selected={zoom}
      triggerClass="phone-zoom-trigger"
      menuClass="zoom-presets"
      onSelect={onZoom}
      onOpenChange={onOpenChange}
    />
  );
}
