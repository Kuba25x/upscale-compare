import type { AlignmentChoices, AlignmentMode, Config, LocalImage } from '../../shared/model';
import { centerOf, comparisonGeometry } from './geometry';

export const alignmentOptions = [
  {
    mode: 'original',
    label: 'Original Size',
    description: 'Keep each image at its original relative pixel size.',
  },
  {
    mode: 'width',
    label: 'Match Width',
    description: 'Scale image B proportionally to match the width of A.',
  },
  {
    mode: 'height',
    label: 'Match Height',
    description: 'Scale image B proportionally to match the height of A.',
  },
] as const;

export function imagePair(
  images: LocalImage[],
  selected: Config['selected'],
): [string, string] | undefined {
  const [a, b] = selected.map((index) => images[index]?.id);
  if (a && b && a !== b) return a < b ? [a, b] : [b, a];
}

export function choiceFor(choices: AlignmentChoices, pair: [string, string] | undefined) {
  return choices.find(({ pair: [a, b] }) => a === pair?.[0] && b === pair[1]);
}

export function retainChoices(choices: AlignmentChoices, images: LocalImage[]): AlignmentChoices {
  const ids = new Set(images.map(({ id }) => id));
  return choices.filter(({ pair }) => pair.every((id) => ids.has(id)));
}

export function selectImages(
  config: Config,
  images: LocalImage[],
  selected: Config['selected'],
  choices: AlignmentChoices,
  centerFit: boolean,
  swap = true,
): Config {
  const [a, b] = selected.map((index) => images[index]);
  if (!a || !b) return { ...config, selected };
  const mode = choiceFor(choices, imagePair(images, selected))?.mode ?? 'original';
  const { relativeScale, bounds } = comparisonGeometry(a, b, mode);
  const reversed = swap && config.selected[0] === selected[1] && config.selected[1] === selected[0];
  if (reversed && relativeScale !== 1) {
    const { x, y } = config.view.center;
    return {
      ...config,
      selected,
      view: { ...config.view, center: { x: x * relativeScale, y: y * relativeScale } },
    };
  }
  return {
    ...config,
    selected,
    view:
      (centerFit || mode !== 'original') && config.view.zoom === null
        ? { zoom: null, center: centerOf(bounds) }
        : config.view,
  };
}

export function changeAlignment(
  config: Config,
  a: LocalImage,
  b: LocalImage,
  from: AlignmentMode,
  to: AlignmentMode,
): Config {
  if (from === to || config.view.zoom !== null) return config;
  const center = centerOf(comparisonGeometry(a, b, from).bounds);
  if (
    Math.abs(center.x - config.view.center.x) > 1e-6 ||
    Math.abs(center.y - config.view.center.y) > 1e-6
  )
    return config;
  return { ...config, view: { zoom: null, center: centerOf(comparisonGeometry(a, b, to).bounds) } };
}
