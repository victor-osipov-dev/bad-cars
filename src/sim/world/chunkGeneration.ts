/**
 * Deterministic chunk generation.
 *
 * `generateChunk` is a pure function of `(coord, seed, worldConfig)`: it never
 * reads global state, never advances a shared RNG, and draws from its own
 * seeded stream in a fixed order. Regenerating a chunk after unloading gives
 * byte-identical content, which is what makes streaming safe.
 */

import { SeededRandom } from '../../core/math/rng';
import {
  PROP_DEFINITIONS,
  type PropKind,
  type PropPlacement,
} from '../../data/gameplay';
import { BASE_CONFIG } from '../../data/bases';
import {
  RESOURCE_DEFINITIONS,
  RESOURCE_KINDS,
  type ResourceKind,
} from '../../data/resources';
import {
  BIOME_DEFINITIONS,
  type BiomeKind,
  type WorldConfig,
} from '../../data/worldgen';
import type { ObstacleCircle } from '../vehicle/VehicleState';

export interface ChunkCoord {
  readonly x: number;
  readonly y: number;
}

export interface ResourceNode {
  readonly id: string;
  readonly kind: ResourceKind;
  readonly x: number;
  readonly y: number;
  readonly amount: number;
}

/** Prepared base pad generated with a chunk. */
export interface BaseSite {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

export interface ChunkData {
  readonly key: string;
  readonly coord: ChunkCoord;
  /** World-space coordinate of the chunk's minimum corner. */
  readonly originX: number;
  readonly originY: number;
  readonly size: number;
  readonly biome: BiomeKind;
  readonly props: readonly PropPlacement[];
  readonly obstacles: readonly ObstacleCircle[];
  readonly resourceNodes: readonly ResourceNode[];
  readonly baseSites: readonly BaseSite[];
}

export function chunkKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function chunkCoordAt(x: number, y: number, chunkSize: number): ChunkCoord {
  return {
    x: Math.floor(x / chunkSize),
    y: Math.floor(y / chunkSize),
  };
}

/** FNV-1a style mix; stable across engines because it only uses imul/xor. */
function hashChunk(seed: number, x: number, y: number): number {
  let hash = (seed ^ 0x9e3779b9) >>> 0;
  hash = Math.imul(hash ^ (x | 0), 0x85ebca6b) >>> 0;
  hash = hash ^ (hash >>> 13);
  hash = Math.imul(hash ^ (y | 0), 0xc2b2ae35) >>> 0;
  hash = hash ^ (hash >>> 16);
  return hash >>> 0;
}

function pickBiome(rng: SeededRandom): BiomeKind {
  const entries = Object.entries(BIOME_DEFINITIONS) as [BiomeKind, { weight: number }][];
  const total = entries.reduce((sum, [, definition]) => sum + definition.weight, 0);
  let roll = rng.next() * total;
  for (const [kind, definition] of entries) {
    roll -= definition.weight;
    if (roll <= 0) return kind;
  }
  return 'wasteland';
}

function pickPropKind(rng: SeededRandom, biome: BiomeKind): PropKind {
  const definition = BIOME_DEFINITIONS[biome];
  if (rng.next() < definition.crateChance) return 'crate';
  return rng.next() < 0.35 ? 'wreck' : 'rock';
}

/** Solid-circle approximation, kept in sync with the renderer's prop sizing. */
function obstacleFor(id: string, prop: PropPlacement): ObstacleCircle | null {
  const definition = PROP_DEFINITIONS[prop.kind];
  if (!definition.solid) return null;
  return {
    id,
    x: prop.x,
    y: prop.y,
    radius: ((definition.width + definition.height) / 4) * prop.scale,
  };
}

/** True when the chunk rectangle comes within `radius` of the spawn point. */
function overlapsSpawn(
  originX: number,
  originY: number,
  size: number,
  spawnX: number,
  spawnY: number,
  radius: number,
): boolean {
  const nearestX = Math.min(Math.max(spawnX, originX), originX + size);
  const nearestY = Math.min(Math.max(spawnY, originY), originY + size);
  const deltaX = spawnX - nearestX;
  const deltaY = spawnY - nearestY;
  return deltaX * deltaX + deltaY * deltaY < radius * radius;
}

export interface GenerateChunkOptions {
  readonly seed: number;
  readonly config: WorldConfig;
  /** Spawn point; chunks near it are left clear for the handcrafted range. */
  readonly spawnX?: number;
  readonly spawnY?: number;
}

export function generateChunk(
  coord: ChunkCoord,
  options: GenerateChunkOptions,
): ChunkData {
  const { seed, config } = options;
  const size = config.chunkSize;
  const originX = coord.x * size;
  const originY = coord.y * size;

  // One independent, deterministic stream per chunk.
  const rng = new SeededRandom(hashChunk(seed, coord.x, coord.y));
  const biome = pickBiome(rng);
  const biomeDefinition = BIOME_DEFINITIONS[biome];

  const nearSpawn =
    options.spawnX !== undefined &&
    options.spawnY !== undefined &&
    overlapsSpawn(
      originX,
      originY,
      size,
      options.spawnX,
      options.spawnY,
      config.spawnClearRadius,
    );

  const props: PropPlacement[] = [];
  const obstacles: ObstacleCircle[] = [];
  const resourceNodes: ResourceNode[] = [];
  const baseSites: BaseSite[] = [];

  if (!nearSpawn) {
    // Prepared pad for a future base. Placed before props so the pad prop can
    // reuse the same coordinates and the site stays clear of clutter.
    if (rng.next() < BASE_CONFIG.siteChance) {
      const siteX = originX + size * 0.5;
      const siteY = originY + size * 0.5;
      baseSites.push({ id: `site-${coord.x}-${coord.y}`, x: siteX, y: siteY });
      props.push({
        id: `chunk-${coord.x}-${coord.y}-pad`,
        kind: 'pad',
        x: siteX,
        y: siteY,
        rotation: 0,
        scale: 1,
      });
    }

    const count =
      biomeDefinition.minProps +
      Math.floor(
        rng.next() * (biomeDefinition.maxProps - biomeDefinition.minProps + 1),
      );

    // 3x3 placement cells keep props from stacking on top of each other.
    const cells = 3;
    const cellSize = size / cells;
    const margin = 2.2;

    for (let index = 0; index < count; index += 1) {
      const cellX = index % cells;
      const cellY = Math.floor(index / cells) % cells;
      const kind = pickPropKind(rng, biome);
      const definition = PROP_DEFINITIONS[kind];
      const halfW = definition.width / 2;
      const halfH = definition.height / 2;

      const jitterX = rng.range(margin, Math.max(margin, cellSize - margin));
      const jitterY = rng.range(margin, Math.max(margin, cellSize - margin));
      const x = originX + cellX * cellSize + jitterX;
      const y = originY + cellY * cellSize + jitterY;

      // Keep the prop body fully inside its chunk so chunks tile seamlessly.
      const clampedX = Math.min(
        Math.max(x, originX + halfW + 0.2),
        originX + size - halfW - 0.2,
      );
      const clampedY = Math.min(
        Math.max(y, originY + halfH + 0.2),
        originY + size - halfH - 0.2,
      );

      // Keep the prepared pad clear so a base never spawns inside a rock.
      const nearSite = baseSites.some(
        (site) => Math.hypot(site.x - clampedX, site.y - clampedY) < 3.6,
      );
      if (nearSite) continue;

      const prop: PropPlacement = {
        id: `chunk-${coord.x}-${coord.y}-${index}`,
        kind,
        x: clampedX,
        y: clampedY,
        rotation: rng.range(-Math.PI, Math.PI),
        scale: rng.range(0.85, 1.35),
      };
      props.push(prop);

      const obstacle = obstacleFor(prop.id, prop);
      if (obstacle) obstacles.push(obstacle);
    }

    if (rng.next() < biomeDefinition.resourceChance) {
      const kind = RESOURCE_KINDS[Math.floor(rng.next() * RESOURCE_KINDS.length)] ?? 'scrap';
      const definition = RESOURCE_DEFINITIONS[kind];
      resourceNodes.push({
        id: `res-${coord.x}-${coord.y}`,
        kind,
        x: originX + rng.range(size * 0.2, size * 0.8),
        y: originY + rng.range(size * 0.2, size * 0.8),
        amount: definition.nodeAmount,
      });
    }
  }

  return {
    key: chunkKey(coord.x, coord.y),
    coord,
    originX,
    originY,
    size,
    biome,
    props,
    obstacles,
    resourceNodes,
    baseSites,
  };
}
