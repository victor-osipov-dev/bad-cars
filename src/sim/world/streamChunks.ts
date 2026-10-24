/**
 * Chunk streaming.
 *
 * Pure bookkeeping around `generateChunk`: given the chunks currently resident
 * and the player's chunk coordinate, decide what to load and what to drop.
 * Keeping this pure makes streaming testable without a renderer or a clock.
 */

import {
  PROP_DEFINITIONS,
  type PropPlacement,
  type ResourceNodeSpawn,
} from '../../data/gameplay';
import { RESOURCE_DEFINITIONS } from '../../data/resources';
import type { WorldConfig } from '../../data/worldgen';
import type { ResourceNodeState } from '../economy/EconomyState';
import type { ObstacleCircle } from '../vehicle/VehicleState';
import type { BaseSiteState } from '../base/BaseState';
import {
  chunkCoordAt,
  chunkKey,
  generateChunk,
  type ChunkCoord,
  type ChunkData,
} from './chunkGeneration';

export interface StreamChunksParams {
  readonly loaded: readonly ChunkData[];
  readonly center: ChunkCoord;
  readonly config: WorldConfig;
  readonly seed: number;
  readonly spawnX: number;
  readonly spawnY: number;
}

export interface StreamChunksResult {
  readonly chunks: readonly ChunkData[];
  readonly loaded: readonly ChunkData[];
  readonly unloadedKeys: readonly string[];
  readonly changed: boolean;
}

function withinSquareRadius(
  a: ChunkCoord,
  b: ChunkCoord,
  radius: number,
): boolean {
  return Math.abs(a.x - b.x) <= radius && Math.abs(a.y - b.y) <= radius;
}

/**
 * Loads chunks inside `activeRadiusChunks` and drops those beyond
 * `unloadRadiusChunks`. The two radii differ on purpose (hysteresis): a chunk
 * on the boundary is not regenerated every tick while the player hovers there.
 */
export function streamChunks(params: StreamChunksParams): StreamChunksResult {
  const { loaded, center, config, seed, spawnX, spawnY } = params;
  const byKey = new Map(loaded.map((chunk) => [chunk.key, chunk]));

  const unloadedKeys: string[] = [];
  for (const chunk of loaded) {
    if (!withinSquareRadius(chunk.coord, center, config.unloadRadiusChunks)) {
      byKey.delete(chunk.key);
      unloadedKeys.push(chunk.key);
    }
  }

  const newlyLoaded: ChunkData[] = [];
  const radius = config.activeRadiusChunks;
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      const coord: ChunkCoord = { x: center.x + dx, y: center.y + dy };
      const key = chunkKey(coord.x, coord.y);
      if (byKey.has(key)) continue;

      const chunk = generateChunk(coord, { seed, config, spawnX, spawnY });
      byKey.set(key, chunk);
      newlyLoaded.push(chunk);
    }
  }

  // Stable ordering (by coordinate) keeps snapshots diff-friendly.
  const chunks = [...byKey.values()].sort((a, b) =>
    a.coord.y === b.coord.y ? a.coord.x - b.coord.x : a.coord.y - b.coord.y,
  );

  return {
    chunks,
    loaded: newlyLoaded,
    unloadedKeys,
    changed: newlyLoaded.length > 0 || unloadedKeys.length > 0,
  };
}

/** Chunk coordinate under a world position. */
export function chunkCoordAtWorld(
  x: number,
  y: number,
  config: WorldConfig,
): ChunkCoord {
  return chunkCoordAt(x, y, config.chunkSize);
}

/**
 * Initial resident set for a spawn point, so the first frame already contains
 * the surrounding world (no empty tick before streaming kicks in).
 */
export function initialChunks(
  config: WorldConfig,
  seed: number,
  spawnX: number,
  spawnY: number,
): readonly ChunkData[] {
  const center = chunkCoordAtWorld(spawnX, spawnY, config);
  const chunks: ChunkData[] = [];
  for (let dx = -config.activeRadiusChunks; dx <= config.activeRadiusChunks; dx += 1) {
    for (let dy = -config.activeRadiusChunks; dy <= config.activeRadiusChunks; dy += 1) {
      chunks.push(
        generateChunk(
          { x: center.x + dx, y: center.y + dy },
          { seed, config, spawnX, spawnY },
        ),
      );
    }
  }
  return chunks.sort((a, b) =>
    a.coord.y === b.coord.y ? a.coord.x - b.coord.x : a.coord.y - b.coord.y,
  );
}

export interface MergedChunkContent {
  readonly props: readonly PropPlacement[];
  readonly obstacles: readonly ObstacleCircle[];
  readonly resourceNodes: readonly ResourceNodeState[];
  readonly baseSites: readonly BaseSiteState[];
}

/**
 * Flattens resident chunks into the render/collision lists the simulation uses.
 * The handcrafted spawn-area props from config stay resident on top of the
 * procedural ones, so the starting range is unchanged.
 */
export function mergeChunkContent(
  spawnProps: readonly PropPlacement[],
  chunks: readonly ChunkData[],
  depletion: Readonly<Record<string, number>> = {},
  spawnNodes: readonly ResourceNodeSpawn[] = [],
): MergedChunkContent {
  const props: PropPlacement[] = [...spawnProps];
  const obstacles: ObstacleCircle[] = [];
  const resourceNodes: ResourceNodeState[] = [];
  const baseSites: BaseSiteState[] = [];

  for (const prop of spawnProps) {
    const definition = PROP_DEFINITIONS[prop.kind];
    if (!definition.solid) continue;
    obstacles.push({
      id: prop.id,
      x: prop.x,
      y: prop.y,
      radius: ((definition.width + definition.height) / 4) * prop.scale,
    });
  }

  for (const node of spawnNodes) {
    const amount = RESOURCE_DEFINITIONS[node.kind].nodeAmount;
    resourceNodes.push({
      id: node.id,
      kind: node.kind,
      x: node.x,
      y: node.y,
      maxAmount: amount,
      remaining: depletion[node.id] ?? amount,
    });
  }

  for (const chunk of chunks) {
    props.push(...chunk.props);
    obstacles.push(...chunk.obstacles);
    baseSites.push(...chunk.baseSites);

    for (const node of chunk.resourceNodes) {
      // Depletion survives chunk unload/reload: the seed would otherwise
      // refill an already mined node every time the player drives back.
      const remaining = depletion[node.id] ?? node.amount;
      resourceNodes.push({
        id: node.id,
        kind: node.kind,
        x: node.x,
        y: node.y,
        maxAmount: node.amount,
        remaining,
      });
    }
  }

  return { props, obstacles, resourceNodes, baseSites };
}
