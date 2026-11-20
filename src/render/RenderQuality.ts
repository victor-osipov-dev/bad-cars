/** Presentation-only graphics presets; gameplay config stays render-agnostic. */

export type RenderQuality = 'low' | 'medium' | 'high';

/** Integer scaling keeps the handcrafted pixel art crisp. */
export const RENDER_QUALITY_SCALING: Readonly<Record<RenderQuality, number>> = {
  low: 3,
  medium: 2,
  high: 1,
};

export const RENDER_QUALITY_OPTIONS: readonly {
  readonly id: RenderQuality;
  readonly label: string;
}[] = [
  { id: 'low', label: 'ЭКОНОМ' },
  { id: 'medium', label: 'НОРМА' },
  { id: 'high', label: 'ЧЁТКО' },
];

export const DEFAULT_RENDER_QUALITY: RenderQuality = 'medium';

export function isRenderQuality(value: unknown): value is RenderQuality {
  return value === 'low' || value === 'medium' || value === 'high';
}
