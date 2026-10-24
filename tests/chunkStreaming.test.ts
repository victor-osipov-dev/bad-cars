import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../src/data/gameplay';
import { DEFAULT_WORLD_CONFIG } from '../src/data/worldgen';
import { Simulation } from '../src/sim/Simulation';

const CONFIG = DEFAULT_WORLD_CONFIG;

function createSimulation(): Simulation {
  return new Simulation({
    ...GAME_CONFIG,
    // Small enough to cross quickly, large enough to avoid the boundary.
    world: { ...CONFIG, halfWidth: 200, halfHeight: 200 },
    enemySpawns: [],
  });
}

describe('chunk streaming in the simulation', () => {
  it('starts with a populated neighbourhood', () => {
    const simulation = createSimulation();
    const snapshot = simulation.snapshot();

    const expected = (CONFIG.activeRadiusChunks * 2 + 1) ** 2;
    expect(snapshot.chunks.active).toBe(expected);
    expect(snapshot.minimap.chunks).toHaveLength(expected);
    expect(snapshot.chunks.unloadedTotal).toBe(0);
  });

  it('loads chunks as the car drives and keeps the set bounded', () => {
    const simulation = createSimulation();
    const limit = (CONFIG.unloadRadiusChunks * 2 + 1) ** 2;

    let maxActive = 0;
    for (let tick = 0; tick < 60 * 30; tick += 1) {
      simulation.step();
      maxActive = Math.max(maxActive, simulation.snapshot().chunks.active);
    }

    const snapshot = simulation.snapshot();
    expect(snapshot.chunks.loadedTotal).toBeGreaterThan(0);
    expect(maxActive).toBeLessThanOrEqual(limit);
    expect(snapshot.chunks.active).toBeLessThanOrEqual(limit);
    expect(snapshot.chunks.unloadedTotal).toBeGreaterThan(0);
  });

  it('keeps props and obstacles consistent with resident chunks', () => {
    const simulation = createSimulation();
    for (let tick = 0; tick < 60 * 20; tick += 1) simulation.step();

    const snapshot = simulation.snapshot();
    const chunkPropCount = simulation.world.chunks.reduce(
      (sum, chunk) => sum + chunk.props.length,
      0,
    );

    expect(snapshot.props).toHaveLength(GAME_CONFIG.props.length + chunkPropCount);
    expect(simulation.world.obstacles.length).toBeLessThanOrEqual(
      simulation.world.props.length,
    );
  });

  it('does not grow memory while driving for a long time', () => {
    const simulation = createSimulation();
    const limit = (CONFIG.unloadRadiusChunks * 2 + 1) ** 2;

    for (let tick = 0; tick < 60 * 10; tick += 1) simulation.step();
    const early = simulation.snapshot().chunks.active;

    for (let tick = 0; tick < 60 * 60; tick += 1) simulation.step();
    const late = simulation.snapshot().chunks.active;

    expect(early).toBeLessThanOrEqual(limit);
    expect(late).toBeLessThanOrEqual(limit);
  });

  it('is deterministic for the same seed and commands', () => {
    const run = (): string => {
      const simulation = createSimulation();
      simulation.queueControls({ steer: 1 }, 1);
      for (let tick = 0; tick < 60 * 12; tick += 1) simulation.step();

      const snapshot = simulation.snapshot();
      return JSON.stringify({
        chunks: snapshot.minimap.chunks,
        stats: snapshot.chunks,
        props: snapshot.props.length,
        position: { x: snapshot.vehicle.x, y: snapshot.vehicle.y },
      });
    };

    expect(run()).toBe(run());
  });

  it('produces a different world for a different seed', () => {
    const base = createSimulation();
    const otherSeed = new Simulation({
      ...GAME_CONFIG,
      world: { ...CONFIG, halfWidth: 200, halfHeight: 200 },
      worldSeed: GAME_CONFIG.worldSeed ^ 0xffff,
      enemySpawns: [],
    });

    const layout = (simulation: Simulation): string =>
      JSON.stringify(simulation.snapshot().props);

    expect(layout(base)).not.toBe(layout(otherSeed));
  });

  it('clamps the car to the world bounds', () => {
    const simulation = new Simulation({
      ...GAME_CONFIG,
      world: { ...CONFIG, halfWidth: 60, halfHeight: 40 },
      enemySpawns: [],
    });

    for (let tick = 0; tick < 60 * 60; tick += 1) simulation.step();

    const snapshot = simulation.snapshot();
    expect(Math.abs(snapshot.vehicle.x)).toBeLessThanOrEqual(60);
    expect(Math.abs(snapshot.vehicle.y)).toBeLessThanOrEqual(40);
  });
});
