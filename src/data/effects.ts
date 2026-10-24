/** Transient combat effect definitions (muzzle flashes, impacts, explosions). */

export type EffectKind = 'muzzle-flash' | 'hit-spark' | 'explosion' | 'debris';

export interface EffectConfig {
  readonly lifetimeSeconds: number;
  /** World-space size of the effect sprite. */
  readonly scale: number;
}

export const EFFECT_CONFIGS: Readonly<Record<EffectKind, EffectConfig>> = {
  'muzzle-flash': { lifetimeSeconds: 0.08, scale: 0.9 },
  'hit-spark': { lifetimeSeconds: 0.18, scale: 0.55 },
  explosion: { lifetimeSeconds: 0.5, scale: 2.6 },
  debris: { lifetimeSeconds: 0.35, scale: 1.1 },
};

/** Effects are purely cosmetic; the cap protects the renderer from bursts. */
export const MAX_ACTIVE_EFFECTS = 80;
