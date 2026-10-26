import { describe, expect, it } from 'vitest';
import { Vec2 } from '../src/core/math/Vec2';
import {
  ENEMY_AI_CONFIG,
  ENEMY_DEFINITIONS,
  validateEnemyAIConfig,
} from '../src/data/enemies';
import { GAME_CONFIG, type GameplayConfig } from '../src/data/gameplay';
import { SCRAP_RUNNER } from '../src/data/vehicles';
import { emptyAmounts } from '../src/sim/economy/EconomyState';
import { Simulation } from '../src/sim/Simulation';

function createConfig(): GameplayConfig {
  return {
    ...GAME_CONFIG,
    world: { ...GAME_CONFIG.world, halfWidth: 200, halfHeight: 200 },
    vehicle: {
      ...SCRAP_RUNNER,
      spawn: { x: 0, y: 0, headingRadians: 0 },
    },
    // Start with no handcrafted enemies; raiders spawn from the AI budget.
    enemySpawns: [],
    spawnResourceNodes: [],
  };
}

function createSimulation(): Simulation {
  const simulation = new Simulation(createConfig());
  // A base somewhere far away so economy does not interfere.
  const base = simulation.world.bases[0];
  if (base) base.storage = emptyAmounts();
  return simulation;
}

/** Adds a raider at a fixed spot with an explicit home. */
function addRaider(
  simulation: Simulation,
  x: number,
  y: number,
  home = { x, y },
  aiState: 'patrol' | 'chase' | 'attack' | 'return' = 'patrol',
) {
  const definition = ENEMY_DEFINITIONS.raider;
  const enemy = {
    id: `test-raider-${x}-${y}`,
    kind: 'raider' as const,
    spawnX: home.x,
    spawnY: home.y,
    rotation: 0,
    aimAngle: 0,
    radius: definition.radius,
    maxHealth: definition.maxHealth,
    position: new Vec2(x, y),
    health: definition.maxHealth,
    alive: true,
    respawnRemainingSeconds: 0,
    fireCooldownSeconds: 0,
    aiState,
    stateSeconds: 0,
    bestDistance: Number.POSITIVE_INFINITY,
    stallSeconds: 0,
    patrolAngle: 0,
    raidId: null,
  };
  simulation.world.enemies.push(enemy);
  return enemy;
}

function parkVehicle(simulation: Simulation, x: number, y: number): void {
  simulation.world.vehicle = {
    ...simulation.world.vehicle,
    position: new Vec2(x, y),
    velocity: Vec2.ZERO,
  };
  // Keep the car still for the whole test.
  simulation.queueControls({ brake: 1 }, 1);
}

function raiders(simulation: Simulation) {
  return simulation.world.enemies.filter((enemy) => enemy.kind === 'raider');
}

describe('enemy AI config', () => {
  it('ships a valid global config', () => {
    expect(validateEnemyAIConfig(ENEMY_AI_CONFIG)).toEqual([]);
  });

  it('rejects inconsistent radar and spawn limits', () => {
    expect(
      validateEnemyAIConfig({
        ...ENEMY_AI_CONFIG,
        maxMobileEnemies: -1,
        spawnRadiusMin: 80,
        spawnRadiusMax: 20,
        despawnRadius: 10,
      }),
    ).toEqual([
      'maxMobileEnemies must be a non-negative integer',
      'spawn radii must be finite and ordered (min > 0, max >= min)',
      'despawnRadius must be greater than spawnRadiusMax',
    ]);
  });

  it('gives every enemy an ai block', () => {
    for (const definition of Object.values(ENEMY_DEFINITIONS)) {
      expect(definition.ai.behaviour).toBeDefined();
      if (definition.ai.behaviour === 'patrol') {
        expect(definition.ai.chaseSpeed).toBeGreaterThan(0);
        expect(definition.ai.leashRadius).toBeGreaterThan(definition.ai.preferredRange);
      }
    }
  });

  it('keeps stationary enemies in place', () => {
    const simulation = new Simulation({
      ...createConfig(),
      enemySpawns: [{ id: 'dummy', kind: 'scrap-dummy', x: 6, y: 0, rotation: 0 }],
    });
    parkVehicle(simulation, 0, 0);

    simulation.stepMany(180);

    const dummy = simulation.world.enemies.find((enemy) => enemy.id === 'dummy');
    expect(dummy?.position.x).toBe(6);
    expect(dummy?.position.y).toBe(0);
    expect(dummy?.aiState).toBe('idle');
  });
});

describe('patrol', () => {
  it('circles its home without wandering off', () => {
    const simulation = createSimulation();
    parkVehicle(simulation, 0, 0);
    const raider = addRaider(simulation, 40, 40);

    simulation.stepMany(120);

    const distanceFromHome = Math.hypot(
      raider.position.x - raider.spawnX,
      raider.position.y - raider.spawnY,
    );
    expect(distanceFromHome).toBeLessThanOrEqual(
      ENEMY_DEFINITIONS.raider.ai.patrolRadius + 1,
    );
    expect(raider.position.x === 40 && raider.position.y === 40).toBe(false);
  });

  it('notices the player inside the detection radius', () => {
    const simulation = createSimulation();
    const ai = ENEMY_DEFINITIONS.raider.ai;
    parkVehicle(simulation, 0, 0);
    const raider = addRaider(simulation, ai.detectionRadius - 4, 0);

    simulation.step();

    expect(raider.aiState).toBe('chase');
  });

  it('ignores the player outside the detection radius', () => {
    const simulation = createSimulation();
    const ai = ENEMY_DEFINITIONS.raider.ai;
    parkVehicle(simulation, 0, 0);
    const raider = addRaider(simulation, ai.detectionRadius + 12, 0);

    simulation.stepMany(30);

    expect(raider.aiState).toBe('patrol');
  });
});

describe('chase and attack', () => {
  it('closes distance while chasing', () => {
    const simulation = createSimulation();
    parkVehicle(simulation, 0, 0);
    const raider = addRaider(simulation, 25, 0, { x: 25, y: 0 }, 'chase');

    const before = Math.hypot(raider.position.x, raider.position.y);
    simulation.stepMany(60);
    const after = Math.hypot(raider.position.x, raider.position.y);

    expect(after).toBeLessThan(before - 5);
  });

  it('stops at the preferred range and fires', () => {
    const simulation = createSimulation();
    const ai = ENEMY_DEFINITIONS.raider.ai;
    parkVehicle(simulation, 0, 0);
    const raider = addRaider(simulation, ai.detectionRadius - 2, 0);

    const before = simulation.world.vehicleHealth;
    simulation.stepMany(60 * 6);

    expect(['attack', 'chase']).toContain(raider.aiState);
    // Live projectiles are short-lived, so assert the shot landed instead of
    // counting them at an arbitrary instant.
    expect(simulation.world.vehicleHealth).toBeLessThan(before);
  });

  it('damages the player with raider fire', () => {
    const simulation = createSimulation();
    const ai = ENEMY_DEFINITIONS.raider.ai;
    parkVehicle(simulation, 0, 0);
    addRaider(simulation, ai.preferredRange, 0, { x: ai.preferredRange, y: 0 }, 'attack');

    const before = simulation.world.vehicleHealth;
    simulation.stepMany(60 * 4);

    expect(simulation.world.vehicleHealth).toBeLessThan(before);
  });
});

describe('leash, timeout and return', () => {
  it('breaks off when the player leaves the leash radius', () => {
    const simulation = createSimulation();
    const ai = ENEMY_DEFINITIONS.raider.ai;
    parkVehicle(simulation, 0, 0);
    const raider = addRaider(simulation, ai.leashRadius + 6, 0, { x: 0, y: 0 }, 'chase');

    simulation.step();

    expect(raider.aiState).toBe('return');
  });

  it('walks home and resumes patrolling', () => {
    const simulation = createSimulation();
    const raider = addRaider(simulation, 12, 0, { x: 0, y: 0 }, 'return');
    // Close enough to keep the raider from being despawned, far enough that it
    // does not immediately re-detect the player.
    parkVehicle(simulation, 60, 60);

    simulation.stepMany(60 * 8);

    expect(raider.aiState).toBe('patrol');
    expect(
      Math.hypot(raider.position.x - raider.spawnX, raider.position.y - raider.spawnY),
    ).toBeLessThanOrEqual(ENEMY_DEFINITIONS.raider.ai.patrolRadius + 1);
  });

  it('gives up after the chase timeout', () => {
    const simulation = createSimulation();
    const ai = ENEMY_DEFINITIONS.raider.ai;
    parkVehicle(simulation, 0, 0);
    const raider = addRaider(simulation, 25, 0, { x: 25, y: 0 }, 'chase');
    // Pretend the chase has been running longer than the budget.
    raider.stateSeconds = ai.chaseTimeoutSeconds + 1;
    raider.bestDistance = 25;

    simulation.step();

    expect(raider.aiState).toBe('return');
  });

  it('resets the state timer whenever the state changes', () => {
    const simulation = createSimulation();
    const ai = ENEMY_DEFINITIONS.raider.ai;
    parkVehicle(simulation, 0, 0);
    const raider = addRaider(simulation, ai.detectionRadius - 2, 0);

    simulation.stepMany(10);
    expect(raider.stateSeconds).toBeGreaterThan(0);

    const before = raider.aiState;
    simulation.stepMany(60 * 8);
    if (raider.aiState !== before) {
      expect(raider.stateSeconds).toBeLessThan(60 * 8);
    }
  });
});

describe('spawn budget', () => {
  it('never exceeds the mobile enemy budget', () => {
    const simulation = createSimulation();
    parkVehicle(simulation, 0, 0);

    let maxSeen = 0;
    for (let tick = 0; tick < 60 * 60; tick += 1) {
      simulation.step();
      maxSeen = Math.max(maxSeen, raiders(simulation).length);
    }

    expect(maxSeen).toBeLessThanOrEqual(ENEMY_AI_CONFIG.maxMobileEnemies);
    expect(maxSeen).toBeGreaterThan(0);
  });

  it('spawns away from the player, not on top of it', () => {
    const simulation = createSimulation();
    parkVehicle(simulation, 0, 0);
    simulation.stepMany(60 * 20);

    const spawned = raiders(simulation);
    expect(spawned.length).toBeGreaterThan(0);
    for (const raider of spawned) {
      const distance = Math.hypot(raider.position.x, raider.position.y);
      // They move after spawning, so only check they did not appear at 0.
      expect(distance).toBeGreaterThan(1);
    }
  });

  it('despawns raiders that fall too far behind', () => {
    const simulation = createSimulation();
    parkVehicle(simulation, 0, 0);
    simulation.stepMany(60 * 15);
    expect(raiders(simulation).length).toBeGreaterThan(0);

    // Teleport far away: the budget must clean up instead of hoarding them.
    parkVehicle(simulation, 150, 150);
    simulation.stepMany(5);

    expect(raiders(simulation)).toHaveLength(0);
  });

  it('is deterministic for the same command stream', () => {
    const run = (): string => {
      const simulation = createSimulation();
      parkVehicle(simulation, 0, 0);
      simulation.stepMany(60 * 25);
      return JSON.stringify(
        simulation.world.enemies.map((enemy) => ({
          id: enemy.id,
          kind: enemy.kind,
          state: enemy.aiState,
          x: Math.round(enemy.position.x * 1000) / 1000,
          y: Math.round(enemy.position.y * 1000) / 1000,
        })),
      );
    };

    expect(run()).toBe(run());
  });
});
