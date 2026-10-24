import { describe, expect, it } from 'vitest';
import { PROP_DEFINITIONS } from '../../data/gameplay';
import { DEFAULT_WORLD_CONFIG, validateWorldConfig } from '../../data/worldgen';
import {
  chunkCoordAt,
  chunkKey,
  generateChunk,
  type ChunkCoord,
} from './chunkGeneration';

const CONFIG = DEFAULT_WORLD_CONFIG;
const SEED = 0x5eed_0a11;

function generate(x: number, y: number, seed = SEED) {
  return generateChunk({ x, y }, { seed, config: CONFIG });
}

function coordsAround(radius: number): ChunkCoord[] {
  const coords: ChunkCoord[] = [];
  for (let x = -radius; x <= radius; x += 1) {
    for (let y = -radius; y <= radius; y += 1) {
      coords.push({ x, y });
    }
  }
  return coords;
}

describe('world config', () => {
  it('ships a valid default config', () => {
    expect(validateWorldConfig(DEFAULT_WORLD_CONFIG)).toEqual([]);
  });

  it('requires unloading to be at least as far as loading', () => {
    const errors = validateWorldConfig({
      ...DEFAULT_WORLD_CONFIG,
      activeRadiusChunks: 3,
      unloadRadiusChunks: 2,
    });
    expect(errors).toContain(
      'world.unloadRadiusChunks must be an integer >= activeRadiusChunks',
    );
  });

  it('rejects non-positive sizes and bounds', () => {
    const errors = validateWorldConfig({
      ...DEFAULT_WORLD_CONFIG,
      halfWidth: 0,
      chunkSize: -1,
      spawnClearRadius: Number.NaN,
    });
    expect(errors).toContain('world.halfWidth must be a finite positive number');
    expect(errors).toContain('world.chunkSize must be a finite positive number');
    expect(errors).toContain(
      'world.spawnClearRadius must be a finite non-negative number',
    );
  });

  it('resolves the chunk coordinate under a world position', () => {
    const size = CONFIG.chunkSize;
    expect(chunkCoordAt(0, 0, size)).toEqual({ x: 0, y: 0 });
    expect(chunkCoordAt(size - 0.001, size - 0.001, size)).toEqual({ x: 0, y: 0 });
    expect(chunkCoordAt(size, size, size)).toEqual({ x: 1, y: 1 });
    // Negative coordinates floor toward -infinity so the grid stays seamless.
    expect(chunkCoordAt(-0.001, -0.001, size)).toEqual({ x: -1, y: -1 });
    expect(chunkCoordAt(-size, -size, size)).toEqual({ x: -1, y: -1 });
    expect(chunkCoordAt(-size - 0.001, -size - 0.001, size)).toEqual({ x: -2, y: -2 });
  });
});

describe('chunk generation determinism', () => {
  it('produces identical chunks for the same seed', () => {
    for (const coord of coordsAround(3)) {
      expect(generate(coord.x, coord.y)).toEqual(generate(coord.x, coord.y));
    }
  });

  it('differs between seeds', () => {
    const different = coordsAround(3).filter(
      (coord) =>
        JSON.stringify(generate(coord.x, coord.y)) !==
        JSON.stringify(generate(coord.x, coord.y, SEED + 1)),
    );
    expect(different.length).toBeGreaterThan(0);
  });

  it('is independent of generation order', () => {
    const forward = coordsAround(2).map((coord) => generate(coord.x, coord.y));
    const reversed = [...coordsAround(2)]
      .reverse()
      .map((coord) => generate(coord.x, coord.y));

    expect(reversed).toEqual([...forward].reverse());
  });

  it('gives every chunk a unique key and prop ids', () => {
    const keys = new Set<string>();
    const propIds = new Set<string>();

    for (const coord of coordsAround(4)) {
      const chunk = generate(coord.x, coord.y);
      expect(keys.has(chunk.key)).toBe(false);
      keys.add(chunk.key);
      expect(chunk.key).toBe(chunkKey(coord.x, coord.y));

      for (const prop of chunk.props) {
        expect(propIds.has(prop.id)).toBe(false);
        propIds.add(prop.id);
      }
    }
  });
});

describe('chunk geometry', () => {
  it('keeps prop bodies fully inside their chunk', () => {
    for (const coord of coordsAround(4)) {
      const chunk = generate(coord.x, coord.y);
      for (const prop of chunk.props) {
        const definition = PROP_DEFINITIONS[prop.kind];
        const halfWidth = (definition.width * prop.scale) / 2;
        const halfHeight = (definition.height * prop.scale) / 2;

        expect(prop.x - halfWidth).toBeGreaterThanOrEqual(chunk.originX - 1e-9);
        expect(prop.x + halfWidth).toBeLessThanOrEqual(chunk.originX + chunk.size + 1e-9);
        expect(prop.y - halfHeight).toBeGreaterThanOrEqual(chunk.originY - 1e-9);
        expect(prop.y + halfHeight).toBeLessThanOrEqual(chunk.originY + chunk.size + 1e-9);
      }
    }
  });

  it('derives obstacles only from solid props', () => {
    for (const coord of coordsAround(3)) {
      const chunk = generate(coord.x, coord.y);
      const solidProps = chunk.props.filter(
        (prop) => PROP_DEFINITIONS[prop.kind].solid,
      );
      expect(chunk.obstacles).toHaveLength(solidProps.length);
      expect(chunk.obstacles.map((obstacle) => obstacle.id)).toEqual(
        solidProps.map((prop) => prop.id),
      );
      for (const obstacle of chunk.obstacles) {
        expect(obstacle.radius).toBeGreaterThan(0);
      }
    }
  });

  it('places resource nodes inside the chunk', () => {
    for (const coord of coordsAround(4)) {
      const chunk = generate(coord.x, coord.y);
      for (const node of chunk.resourceNodes) {
        expect(node.x).toBeGreaterThanOrEqual(chunk.originX);
        expect(node.x).toBeLessThanOrEqual(chunk.originX + chunk.size);
        expect(node.y).toBeGreaterThanOrEqual(chunk.originY);
        expect(node.y).toBeLessThanOrEqual(chunk.originY + chunk.size);
        expect(node.amount).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the handcrafted spawn range clear of procedural props', () => {
    const spawnX = -24;
    const spawnY = -10;

    for (const coord of coordsAround(4)) {
      const chunk = generateChunk(coord, {
        seed: SEED,
        config: CONFIG,
        spawnX,
        spawnY,
      });

      const nearestX = Math.min(
        Math.max(spawnX, chunk.originX),
        chunk.originX + chunk.size,
      );
      const nearestY = Math.min(
        Math.max(spawnY, chunk.originY),
        chunk.originY + chunk.size,
      );
      const distance = Math.hypot(spawnX - nearestX, spawnY - nearestY);

      if (distance < CONFIG.spawnClearRadius) {
        expect(chunk.props).toEqual([]);
        expect(chunk.obstacles).toEqual([]);
      }
    }
  });

  it('fills the world with more than one biome', () => {
    const biomes = new Set(
      coordsAround(6).map((coord) => generate(coord.x, coord.y).biome),
    );
    expect(biomes.size).toBeGreaterThan(1);
  });

  it('varies prop density between biomes', () => {
    const perBiome = new Map<string, number[]>();
    for (const coord of coordsAround(6)) {
      const chunk = generate(coord.x, coord.y);
      const list = perBiome.get(chunk.biome) ?? [];
      list.push(chunk.props.length);
      perBiome.set(chunk.biome, list);
    }

    const average = (values: number[]): number =>
      values.reduce((sum, value) => sum + value, 0) / values.length;

    const scrapyard = perBiome.get('scrapyard');
    const dunes = perBiome.get('dunes');
    if (scrapyard && dunes && scrapyard.length > 2 && dunes.length > 2) {
      expect(average(scrapyard)).toBeGreaterThan(average(dunes));
    }
  });
});
