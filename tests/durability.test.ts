import { describe, expect, it } from 'vitest';
import type { EnemySpawn } from '../src/data/enemies';
import { GAME_CONFIG, type GameplayConfig } from '../src/data/gameplay';
import { SCRAP_RUNNER } from '../src/data/vehicles';
import { MACHINE_GUN } from '../src/data/weapons';
import { Simulation } from '../src/sim/Simulation';

interface Options {
  readonly enemySpawns?: readonly EnemySpawn[];
  readonly maxHealth?: number;
  readonly respawnSeconds?: number;
}

function createConfig(options: Options = {}): GameplayConfig {
  return {
    ...GAME_CONFIG,
    world: { ...GAME_CONFIG.world, halfWidth: 60, halfHeight: 40 },
    vehicle: {
      ...SCRAP_RUNNER,
      spawn: { x: 0, y: 0, headingRadians: 0 },
      durability: {
        maxHealth: options.maxHealth ?? SCRAP_RUNNER.durability.maxHealth,
        respawnSeconds: options.respawnSeconds ?? SCRAP_RUNNER.durability.respawnSeconds,
      },
    },
    enemySpawns: options.enemySpawns ?? [
      { id: 'gunner', kind: 'scrap-dummy', x: 8, y: 0, rotation: 0 },
    ],
    loadout: [{ weaponId: MACHINE_GUN.id, reserveAmmo: 64 }],
  };
}

/** Holds the car still so distance-based enemy behaviour stays predictable. */
function hold(simulation: Simulation): void {
  simulation.queueControls({ brake: 1 }, 1);
}

function enemyProjectileIds(simulation: Simulation): readonly number[] {
  return simulation.world.projectiles
    .filter((projectile) => projectile.owner === 'enemy')
    .map((projectile) => projectile.id);
}

describe('enemy fire', () => {
  it('damages the player when the turret has a target in range', () => {
    const simulation = new Simulation(createConfig());
    hold(simulation);
    const maxHealth = simulation.world.vehicleHealth;

    for (let tick = 0; tick < 180; tick += 1) simulation.step();

    expect(simulation.world.vehicleHealth).toBeLessThan(maxHealth);
    expect(simulation.world.vehicleHealth).toBeGreaterThanOrEqual(0);
  });

  it('does not fire when the player is out of range', () => {
    const simulation = new Simulation(
      createConfig({
        enemySpawns: [{ id: 'far', kind: 'scrap-dummy', x: 55, y: 0, rotation: 0 }],
      }),
    );
    hold(simulation);

    const seen = new Set<number>();
    for (let tick = 0; tick < 240; tick += 1) {
      simulation.step();
      for (const id of enemyProjectileIds(simulation)) seen.add(id);
    }

    expect(seen.size).toBe(0);
    expect(simulation.world.vehicleHealth).toBe(
      SCRAP_RUNNER.durability.maxHealth,
    );
  });

  it('respects the fire interval instead of shooting every tick', () => {
    const simulation = new Simulation(createConfig());
    hold(simulation);

    const seen = new Set<number>();
    const ticks = 300;
    for (let tick = 0; tick < ticks; tick += 1) {
      simulation.step();
      for (const id of enemyProjectileIds(simulation)) seen.add(id);
    }

    // scrap-dummy fires every 1.6 s = 96 ticks, so 300 ticks allow ~4 shots.
    const intervalTicks = Math.round(1.6 * GAME_CONFIG.fixedStepHz);
    const expected = Math.ceil(ticks / intervalTicks);
    expect(seen.size).toBeGreaterThan(0);
    expect(seen.size).toBeLessThanOrEqual(expected);
  });

  it('never lets vehicle health go below zero', () => {
    const simulation = new Simulation(createConfig({ maxHealth: 5 }));
    hold(simulation);

    for (let tick = 0; tick < 600; tick += 1) {
      simulation.step();
      expect(simulation.world.vehicleHealth).toBeGreaterThanOrEqual(0);
    }
  });

  it('leaves the player unharmed when no enemies exist', () => {
    const simulation = new Simulation(createConfig({ enemySpawns: [] }));
    hold(simulation);
    simulation.queueAimControls({ aimPoint: { x: 10, y: 0 }, fire: true }, 1);

    for (let tick = 0; tick < 300; tick += 1) simulation.step();

    expect(simulation.world.vehicleHealth).toBe(
      SCRAP_RUNNER.durability.maxHealth,
    );
  });
});

describe('vehicle durability and respawn', () => {
  it('wrecks the car, freezes it, then respawns it at full health', () => {
    const respawnSeconds = 1;
    const simulation = new Simulation(
      createConfig({ maxHealth: 4, respawnSeconds }),
    );
    hold(simulation);

    // One scrap-dummy hit deals 4 damage, so a single hit wrecks the car.
    let guard = 0;
    while (!simulation.world.vehicleDestroyed && guard < 300) {
      simulation.step();
      guard += 1;
    }
    expect(simulation.world.vehicleDestroyed).toBe(true);
    expect(simulation.world.vehicleHealth).toBe(0);
    expect(simulation.world.vehicleRespawnRemainingSeconds).toBeGreaterThan(0);

    const wreckPosition = {
      x: simulation.world.vehicle.position.x,
      y: simulation.world.vehicle.position.y,
    };
    const wreckTick = simulation.time.tick;
    for (let tick = 0; tick < 20; tick += 1) simulation.step();
    expect(simulation.time.tick).toBe(wreckTick + 20);
    expect(simulation.world.vehicle.position.x).toBeCloseTo(wreckPosition.x, 10);
    expect(simulation.world.vehicle.position.y).toBeCloseTo(wreckPosition.y, 10);
    expect(simulation.world.vehicleDestroyed).toBe(true);

    // Run until the respawn delay expires. Movement is skipped while wrecked
    // and the durability system teleports the car, so this tick lands exactly
    // on the configured spawn point.
    let guardTicks = 0;
    while (simulation.world.vehicleDestroyed && guardTicks < 600) {
      simulation.step();
      guardTicks += 1;
    }
    // The countdown starts on the destruction tick, so measure from there.
    const sinceWreck = simulation.time.tick - wreckTick;
    const expectedTicks = Math.ceil(respawnSeconds * GAME_CONFIG.fixedStepHz);
    expect(sinceWreck).toBeGreaterThanOrEqual(expectedTicks - 1);
    expect(sinceWreck).toBeLessThanOrEqual(expectedTicks + 2);

    expect(simulation.world.vehicleDestroyed).toBe(false);
    expect(simulation.world.vehicleHealth).toBe(4);
    expect(simulation.world.vehicleRespawnRemainingSeconds).toBe(0);
    expect(simulation.world.vehicle.position.x).toBe(0);
    expect(simulation.world.vehicle.position.y).toBe(0);
    expect(simulation.world.vehicle.velocity.x).toBe(0);
  });

  it('exposes health and wreck state in the render snapshot', () => {
    const simulation = new Simulation(createConfig({ maxHealth: 4 }));
    hold(simulation);

    let guard = 0;
    while (!simulation.snapshot().vehicle.destroyed && guard < 300) {
      simulation.step();
      guard += 1;
    }

    const snapshot = simulation.snapshot();
    expect(snapshot.vehicle.destroyed).toBe(true);
    expect(snapshot.vehicle.health).toBe(0);
    expect(snapshot.vehicle.maxHealth).toBe(4);
  });

  it('is deterministic for the same config and tick count', () => {
    const run = (): string => {
      const simulation = new Simulation(createConfig({ maxHealth: 30 }));
      hold(simulation);
      for (let tick = 0; tick < 400; tick += 1) simulation.step();
      const snapshot = simulation.snapshot();
      return JSON.stringify({
        health: snapshot.vehicle.health,
        destroyed: snapshot.vehicle.destroyed,
        x: snapshot.vehicle.x,
        y: snapshot.vehicle.y,
        projectiles: snapshot.combat.projectiles.length,
        enemies: snapshot.combat.enemies.map((enemy) => enemy.health),
      });
    };

    expect(run()).toBe(run());
  });
});
