/**
 * Procedural world generation config.
 *
 * The world is an infinite-in-principle grid of square chunks. Every chunk is
 * produced by a pure function of `(worldSeed, chunkX, chunkY)`, so the same
 * seed always yields the same world — no stored state, no ordering effects.
 * Only chunks near the player are materialised; see `streamChunks`.
 */

/** World-space size of one square chunk. */
export const CHUNK_SIZE = 24;

/** How many chunks around the player stay loaded (square radius). */
export const CHUNK_ACTIVE_RADIUS = 2;

/**
 * Chunks are released only past this radius. The gap between loading and
 * unloading (hysteresis) stops a chunk that sits exactly on the boundary from
 * being regenerated every few ticks while the car hovers there.
 */
export const CHUNK_UNLOAD_RADIUS = 3;

/** Biome assigned per chunk by a coordinate hash. */
export type BiomeKind = 'wasteland' | 'dunes' | 'scrapyard' | 'ruins';

export interface BiomeDefinition {
  readonly displayName: string;
  /** Relative frequency in the biome roll; weights need not sum to 1. */
  readonly weight: number;
  /** Chunks the feature grid starts from. */
  readonly minProps: number;
  readonly maxProps: number;
  /** Chance a placed prop is a crate instead of a rock/wreck. */
  readonly crateChance: number;
  /** Chance a chunk grows resource nodes (used from stage 5). */
  readonly resourceChance: number;
  /** Ground tint multiplier hint for the renderer, 0..1 brightness. */
  readonly groundShade: number;
}

export const BIOME_DEFINITIONS: Readonly<Record<BiomeKind, BiomeDefinition>> = {
  wasteland: {
    displayName: 'Wasteland',
    weight: 40,
    minProps: 1,
    maxProps: 3,
    crateChance: 0.18,
    resourceChance: 0.12,
    groundShade: 1,
  },
  dunes: {
    displayName: 'Dunes',
    weight: 22,
    minProps: 0,
    maxProps: 2,
    crateChance: 0.05,
    resourceChance: 0.08,
    groundShade: 1.08,
  },
  scrapyard: {
    displayName: 'Scrapyard',
    weight: 24,
    minProps: 3,
    maxProps: 6,
    crateChance: 0.55,
    resourceChance: 0.3,
    groundShade: 0.92,
  },
  ruins: {
    displayName: 'Ruins',
    weight: 14,
    minProps: 2,
    maxProps: 5,
    crateChance: 0.3,
    resourceChance: 0.22,
    groundShade: 0.86,
  },
};

/** Resource nodes are generated here and harvested in stage 5. */
export type { ResourceKind as ResourceNodeKind } from './resources';

export interface WorldConfig {
  /** World half extents in world units; the car cannot leave them. */
  readonly halfWidth: number;
  readonly halfHeight: number;
  readonly chunkSize: number;
  readonly activeRadiusChunks: number;
  readonly unloadRadiusChunks: number;
  /** Chunks overlapping this circle around the spawn point stay handcrafted. */
  readonly spawnClearRadius: number;
}

export const DEFAULT_WORLD_CONFIG: WorldConfig = {
  halfWidth: 320,
  halfHeight: 320,
  chunkSize: CHUNK_SIZE,
  activeRadiusChunks: CHUNK_ACTIVE_RADIUS,
  unloadRadiusChunks: CHUNK_UNLOAD_RADIUS,
  spawnClearRadius: 26,
};

export function validateWorldConfig(config: WorldConfig): readonly string[] {
  const errors: string[] = [];

  if (!Number.isFinite(config.halfWidth) || config.halfWidth <= 0) {
    errors.push('world.halfWidth must be a finite positive number');
  }
  if (!Number.isFinite(config.halfHeight) || config.halfHeight <= 0) {
    errors.push('world.halfHeight must be a finite positive number');
  }
  if (!Number.isFinite(config.chunkSize) || config.chunkSize <= 0) {
    errors.push('world.chunkSize must be a finite positive number');
  }
  if (
    !Number.isInteger(config.activeRadiusChunks) ||
    config.activeRadiusChunks < 0
  ) {
    errors.push('world.activeRadiusChunks must be a non-negative integer');
  }
  if (
    !Number.isInteger(config.unloadRadiusChunks) ||
    config.unloadRadiusChunks < config.activeRadiusChunks
  ) {
    errors.push('world.unloadRadiusChunks must be an integer >= activeRadiusChunks');
  }
  if (
    !Number.isFinite(config.spawnClearRadius) ||
    config.spawnClearRadius < 0
  ) {
    errors.push('world.spawnClearRadius must be a finite non-negative number');
  }

  return errors;
}
