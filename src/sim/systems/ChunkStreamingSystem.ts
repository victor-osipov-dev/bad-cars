import type { ChunkCoord } from '../world/chunkGeneration';
import {
  chunkCoordAtWorld,
  mergeChunkContent,
  streamChunks,
} from '../world/streamChunks';
import type { SimulationContext, System } from '../System';

function sameCoord(a: ChunkCoord, b: ChunkCoord): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * Keeps the resident chunk set centred on the player.
 *
 * Runs before movement so collisions always use the current neighbourhood.
 * Recomputing only on chunk-coordinate changes keeps the steady-state cost at
 * one integer compare per tick, and hysteresis inside `streamChunks` prevents
 * boundary thrashing.
 */
export class ChunkStreamingSystem implements System {
  readonly id = 'chunk-streaming';

  update(context: SimulationContext, _deltaSeconds: number): void {
    const world = context.world;
    const config = context.config.world;
    const { spawn } = context.config.vehicle;

    const center = chunkCoordAtWorld(
      world.vehicle.position.x,
      world.vehicle.position.y,
      config,
    );
    if (sameCoord(center, world.streamingCenter)) return;

    const result = streamChunks({
      loaded: world.chunks,
      center,
      config,
      seed: context.config.worldSeed,
      spawnX: spawn.x,
      spawnY: spawn.y,
    });

    world.streamingCenter = center;
    if (!result.changed) return;

    world.chunks = result.chunks;
    const merged = mergeChunkContent(
      context.config.props,
      result.chunks,
      world.economy.depletion,
      context.config.spawnResourceNodes,
    );
    world.props = merged.props;
    world.obstacles = merged.obstacles;
    world.resourceNodes = [...merged.resourceNodes];
    world.chunkStats = {
      loadedTotal: world.chunkStats.loadedTotal + result.loaded.length,
      unloadedTotal: world.chunkStats.unloadedTotal + result.unloadedKeys.length,
      active: result.chunks.length,
    };
  }
}
