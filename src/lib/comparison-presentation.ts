import type { CSSProperties } from 'react';

/** Presentation only. Window policy and viewport measurements belong to the platform adapter. */
export interface ComparisonPresentation {
  edgeToEdge: boolean;
  ready: boolean;
  compact: boolean;
  minimalist: boolean;
  phone?: 'portrait' | 'landscape';
  viewportKey?: string;
  insets?: {
    layoutTop: number;
    layoutBottom: number;
    safeTop: number;
    safeRight: number;
    safeBottom: number;
    safeLeft: number;
  };
}

export const WEB_PRESENTATION: ComparisonPresentation = {
  edgeToEdge: false,
  ready: true,
  compact: false,
  minimalist: false,
};

export function presentationClasses(presentation: ComparisonPresentation): string {
  return [
    presentation.edgeToEdge && 'comparison-edge-to-edge',
    presentation.ready && 'comparison-layout-ready',
    presentation.compact && 'comparison-compact',
    presentation.minimalist && 'comparison-minimalist',
    presentation.phone && `comparison-phone-${presentation.phone}`,
  ]
    .filter(Boolean)
    .join(' ');
}

export function phoneOrientation(
  screen: { width: number; height: number },
  landscape: boolean,
): ComparisonPresentation['phone'] {
  // Use the screen's short edge so a narrow window or an open keyboard does not make a tablet a phone.
  const shortEdge = Math.min(screen.width, screen.height);
  if (shortEdge > 0 && shortEdge < 600) return landscape ? 'landscape' : 'portrait';
}

export function presentationStyle({ insets }: ComparisonPresentation): CSSProperties {
  return Object.fromEntries(
    Object.entries(insets ?? {}).map(([key, value]) => [
      `--comparison-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
      `${value}px`,
    ]),
  );
}
