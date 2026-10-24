import { describe, expect, it } from 'vitest';
import { DEFAULT_WORLD_CONFIG } from '../../data/worldgen';
import { chunkCoordAt } from './chunkGeneration';
import {
  initialChunks,
  mergeChunkContent,
  streamChunks,
} from './streamChunks';

const CONFIG = DEFAULT_WORLD_CONFIG;
const SEED = 0x5eed_0a11;
const SPAWN_X = -24;
const SPAWN_Y = -10;

function at(x: number, y: number) {
  return chunkCoordAt(x, y, CONFIG.chunkSize);
}

function initial() {
  return initialChunks(CONFIG, SEED, SPAWN_X, SPAWN_Y);
}

function stream(loaded: ReturnType<typeof initial>, x: number, y: number) {
  return streamChunks({
    loaded,
    center: at(x, y),
    config: CONFIG,
    seed: SEED,
    spawnX: SPAWN_X,
    spawnY: SPAWN_Y,
  });
}

const EXPECTED_ACTIVE = (CONFIG.activeRadiusChunks * 2 + 1) ** 2;

describe('initial chunk set', () => {
  it('fills the active radius around the spawn chunk', () => {
    const chunks = initial();
    expect(chunks).toHaveLength(EXPECTED_ACTIVE);

    const center = at(SPAWN_X, SPAWN_Y);
    for (const chunk of chunks) {
      expect(Math.abs(chunk.coord.x - center.x)).toBeLessThanOrEqual(
        CONFIG.activeRadiusChunks,
      );
      expect(Math.abs(chunk.coord.y - center.y)).toBeLessThanOrEqual(
        CONFIG.activeRadiusChunks,
      );
    }
  });

  it('returns a stable, coordinate-sorted order', () => {
    const keys = initial().map((chunk) => chunk.key);
    expect(keys).toEqual([...keys].sort((a, b) => {
      const [ax = 0, ay = 0] = a.split(',').map(Number);
      const [bx = 0, by = 0] = b.split(',').map(Number);
      return ay === by ? ax - bx : ay - by;
    }));
  });
});

describe('streaming', () => {
  it('does nothing while the player stays inside the same chunk', () => {
    const chunks = initial();
    const result = stream(chunks, SPAWN_X + 1, SPAWN_Y + 1);

    expect(result.changed).toBe(false);
    expect(result.chunks).toEqual(chunks);
    expect(result.loaded).toEqual([]);
    expect(result.unloadedKeys).toEqual([]);
  });

  it('loads the full radius around the new centre', () => {
    const chunks = initial();
    const size = CONFIG.chunkSize;
    // Jump beyond both radii: the new neighbourhood must be fully present.
    const result = stream(chunks, SPAWN_X + size * 5, SPAWN_Y);
    const center = at(SPAWN_X + size * 5, SPAWN_Y);

    expect(result.changed).toBe(true);
    expect(result.loaded.length).toBeGreaterThan(0);

    const keys = new Set(result.chunks.map((chunk) => chunk.key));
    for (let dx = -CONFIG.activeRadiusChunks; dx <= CONFIG.activeRadiusChunks; dx += 1) {
      for (let dy = -CONFIG.activeRadiusChunks; dy <= CONFIG.activeRadiusChunks; dy += 1) {
        expect(keys.has(`${center.x + dx},${center.y + dy}`)).toBe(true);
      }
    }
  });

  it('does not unload chunks inside the hysteresis band', () => {
    const chunks = initial();
    const size = CONFIG.chunkSize;
    // One chunk over: outside the load radius, inside the unload radius.
    const result = stream(chunks, SPAWN_X + size, SPAWN_Y);

    expect(result.unloadedKeys).toEqual([]);
    // The trailing column is still resident, so the set grows past the load
    // radius instead of thrashing.
    expect(result.chunks.length).toBeGreaterThan(EXPECTED_ACTIVE);
    expect(result.chunks.length).toBeLessThanOrEqual(
      (CONFIG.unloadRadiusChunks * 2 + 1) ** 2,
    );
  });

  it('unloads only once the player moves past the unload radius', () => {
    const chunks = initial();
    const size = CONFIG.chunkSize;
    const result = stream(
      chunks,
      SPAWN_X + size * (CONFIG.unloadRadiusChunks + 1),
      SPAWN_Y,
    );

    expect(result.unloadedKeys.length).toBeGreaterThan(0);
    for (const key of result.unloadedKeys) {
      expect(chunks.some((chunk) => chunk.key === key)).toBe(true);
      expect(result.chunks.some((chunk) => chunk.key === key)).toBe(false);
    }
  });

  it('regenerates an unloaded chunk byte-identically', () => {
    const size = CONFIG.chunkSize;
    const start = initial();
    const origin = at(SPAWN_X, SPAWN_Y);

    const far = stream(start, SPAWN_X + size * 12, SPAWN_Y);
    expect(far.chunks.some((chunk) => chunk.key === `${origin.x},${origin.y}`)).toBe(
      false,
    );

    const back = stream(far.chunks, SPAWN_X, SPAWN_Y);
    const reloaded = back.chunks.find((chunk) => chunk.key === `${origin.x},${origin.y}`);
    const original = start.find((chunk) => chunk.key === `${origin.x},${origin.y}`);

    expect(reloaded).toEqual(original);
  });

  it('keeps the resident set bounded while driving across the world', () => {
    const size = CONFIG.chunkSize;
    let chunks = initial();
    let maxResident = chunks.length;

    for (let step = 1; step <= 60; step += 1) {
      const result = stream(chunks, SPAWN_X + size * step, SPAWN_Y);
      chunks = result.chunks;
      maxResident = Math.max(maxResident, chunks.length);
    }

    // Memory stays flat regardless of how far we travel.
    expect(maxResident).toBeLessThanOrEqual((CONFIG.unloadRadiusChunks * 2 + 1) ** 2);
    expect(chunks.length).toBeLessThanOrEqual((CONFIG.unloadRadiusChunks * 2 + 1) ** 2);
  });

  it('is deterministic: the same journey yields the same resident set', () => {
    const run = () => {
      const size = CONFIG.chunkSize;
      let chunks = initial();
      const visited: string[][] = [];
      for (let step = 0; step < 20; step += 1) {
        chunks = stream(chunks, SPAWN_X + size * step, SPAWN_Y + size * (step % 3)).chunks;
        visited.push(chunks.map((chunk) => chunk.key));
      }
      return visited;
    };

    expect(run()).toEqual(run());
  });
});

describe('merged content', () => {
  const spawnProps = [
    { id: 'rock-a', kind: 'rock' as const, x: 0, y: 0, rotation: 0, scale: 1 },
    { id: 'pad-a', kind: 'pad' as const, x: 2, y: 0, rotation: 0, scale: 1 },
  ];

  it('keeps handcrafted spawn props on top of procedural ones', () => {
    const chunks = initial();
    const merged = mergeChunkContent(spawnProps, chunks);

    expect(merged.props.slice(0, spawnProps.length)).toEqual(spawnProps);
    const proceduralCount = chunks.reduce((sum, chunk) => sum + chunk.props.length, 0);
    expect(merged.props).toHaveLength(spawnProps.length + proceduralCount);
  });

  it('builds obstacles only for solid props', () => {
    const chunks = initial();
    const merged = mergeChunkContent(spawnProps, chunks);

    expect(merged.obstacles.some((obstacle) => obstacle.id === 'rock-a')).toBe(true);
    // Pads are not solid, so they must not become colliders.
    expect(merged.obstacles.some((obstacle) => obstacle.id === 'pad-a')).toBe(false);
    expect(merged.obstacles).toHaveLength(
      1 + chunks.reduce((sum, chunk) => sum + chunk.obstacles.length, 0),
    );
  });

  it('drops obstacles belonging to unloaded chunks', () => {
    const size = CONFIG.chunkSize;
    const chunks = initial();
    const moved = stream(chunks, SPAWN_X + size * 12, SPAWN_Y);
    const after = mergeChunkContent(spawnProps, moved.chunks);

    expect(moved.unloadedKeys.length).toBeGreaterThan(0);

    const afterIds = new Set(after.obstacles.map((obstacle) => obstacle.id));
    for (const key of moved.unloadedKeys) {
      const prefix = `chunk-${key.replace(',', '-')}-`;
      expect([...afterIds].some((id) => id.startsWith(prefix))).toBe(false);
    }

    // Every remaining procedural obstacle belongs to a resident chunk.
    // Chunk ids are `chunk-<x>-<y>-<index>` and x/y may be negative, so parse
    // with a pattern instead of splitting on '-'.
    const resident = new Set(moved.chunks.map((chunk) => chunk.key));
    const idPattern = /^chunk-(-?\d+)-(-?\d+)-\d+$/;
    for (const id of afterIds) {
      const match = idPattern.exec(id);
      if (!match) continue;
      expect(resident.has(`${match[1]},${match[2]}`)).toBe(true);
    }
  });
});
