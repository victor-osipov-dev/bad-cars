/** Transient combat effect definitions (muzzle flashes, impacts, explosions). */

export type EffectKind = 'muzzle-flash' | 'hit-spark' | 'explosion' | 'debris' | 'repair';

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
  // Drone that visibly repairs a destroyed turret; lifetime is overridden at
  // spawn to match that turret's respawn delay.
  repair: { lifetimeSeconds: 1, scale: 2.2 },
};

/** Effects are purely cosmetic; the cap protects the renderer from bursts. */
export const MAX_ACTIVE_EFFECTS = 80;

/**
 * Choreography of the mobile repair crew that restores a destroyed turret.
 *
 * The turret revives exactly when the `workSeconds` phase ends; the crew then
 * drives back to the depot while the turret is already operational. Keeping
 * the numbers shared means the simulation timer and the visual never disagree.
 */
export const REPAIR_PROCESS = {
  /** Idle time after destruction before the crew leaves the depot, seconds. */
  delaySeconds: 2.5,
  /** Drive speed of the maintenance vehicle, world units per second. */
  vehicleSpeed: 16,
  /** Depot position relative to the repaired turret, world units. */
  depotOffsetX: -26,
  depotOffsetY: -20,
  /** Time the crew stays parked after the turret comes online, seconds. */
  holdSeconds: 1,
  /** Drive time back to the depot after the turret is restored, seconds. */
  returnSeconds: 3,
} as const;
