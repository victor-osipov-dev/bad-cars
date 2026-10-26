import { describe, expect, it } from 'vitest';
import { Vec2 } from '../src/core/math/Vec2';
import { STRUCTURE_DEFINITIONS } from '../src/data/bases';
import {
  MINE_CONFIG,
  SENSOR_CONFIG,
  TURRET_DEFENSE,
  validateDefenseConfigs,
} from '../src/data/defense';
import { ENEMY_DEFINITIONS } from '../src/data/enemies';
import { GAME_CONFIG, type GameplayConfig } from '../src/data/gameplay';
import { SCRAP_RUNNER } from '../src/data/vehicles';
import { createStructure, type BaseState } from '../src/sim/base/BaseState';
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
    enemySpawns: [],
    spawnResourceNodes: [],
  };
}

function baseOf(simulation: Simulation): BaseState {
  const base = simulation.world.bases[0];
  if (!base) throw new Error('expected a base');
  return base;
}

/** Adds a structure to the starter base with full condition. */
function addStructure(
  simulation: Simulation,
  kind: Parameters<typeof createStructure>[0]['kind'],
  x: number,
  y: number,
): ReturnType<typeof createStructure> {
  const base = baseOf(simulation);
  const structure = createStructure({
    id: `test-${kind}-${x}-${y}`,
    kind,
    x,
    y,
    slotIndex: base.structures.length,
    builtTick: 0,
    maxCondition: 3,
  });
  base.structures.push(structure);
  // Plenty of fuel so the turret stays powered.
  base.storage = { scrap: 100, fuel: 100, water: 100 };
  return structure;
}

function addEnemy(
  simulation: Simulation,
  x: number,
  y: number,
  kind: 'raider' | 'scrap-dummy' | 'heavy-dummy' = 'raider',
) {
  const definition = ENEMY_DEFINITIONS[kind];
  const enemy = {
    id: `enemy-${x}-${y}`,
    kind,
    spawnX: x,
    spawnY: y,
    rotation: 0,
    aimAngle: 0,
    radius: definition.radius,
    maxHealth: definition.maxHealth,
    position: new Vec2(x, y),
    health: definition.maxHealth,
    alive: true,
    respawnRemainingSeconds: 0,
    fireCooldownSeconds: 0,
    aiState: 'idle' as const,
    stateSeconds: 0,
    bestDistance: Number.POSITIVE_INFINITY,
    stallSeconds: 0,
    patrolAngle: 0,
  };
  simulation.world.enemies.push(enemy);
  return enemy;
}

/** Base position is immutable, so replace the record. */
function moveBaseTo(simulation: Simulation, x: number, y: number): void {
  const base = baseOf(simulation);
  simulation.world.bases[0] = { ...base, x, y };
}

function parkVehicle(simulation: Simulation, x: number, y: number): void {
  simulation.world.vehicle = {
    ...simulation.world.vehicle,
    position: new Vec2(x, y),
    velocity: Vec2.ZERO,
  };
  simulation.queueControls({ brake: 1 }, 1);
}

describe('defence config', () => {
  it('ships valid numbers', () => {
    expect(validateDefenseConfigs(TURRET_DEFENSE, MINE_CONFIG, SENSOR_CONFIG)).toEqual([]);
  });

  it('rejects inconsistent sensor and mine settings', () => {
    expect(
      validateDefenseConfigs(
        { ...TURRET_DEFENSE, damage: 0 },
        { ...MINE_CONFIG, blastRadius: 1, triggerRadius: 5 },
        { ...SENSOR_CONFIG, attackRadius: 90, radarRadius: 40 },
      ),
    ).toEqual([
      'turret.damage must be a finite positive number',
      'sensor.attackRadius cannot exceed sensor.radarRadius',
      'mine.blastRadius must be at least mine.triggerRadius',
    ]);
  });

  it('makes mines cheap and limited', () => {
    expect(STRUCTURE_DEFINITIONS.mine.limitPerBase).toBeGreaterThan(0);
    expect(STRUCTURE_DEFINITIONS.mine.cost.scrap).toBeGreaterThan(0);
  });
});

describe('base turrets', () => {
  it('shoots a hostile inside its range', () => {
    const simulation = new Simulation(createConfig());
    parkVehicle(simulation, 0, 0);
    addStructure(simulation, 'turret', 5, 0);
    const enemy = addEnemy(simulation, 15, 0);

    simulation.stepMany(60 * 3);

    expect(enemy.health).toBeLessThan(enemy.maxHealth);
  });

  it('kills and removes a target that stays in range', () => {
    const simulation = new Simulation(createConfig());
    parkVehicle(simulation, 0, 0);
    addStructure(simulation, 'turret', 5, 0);
    const enemy = addEnemy(simulation, 12, 0);

    simulation.stepMany(60 * 20);

    expect(enemy.health).toBe(0);
    expect(enemy.alive).toBe(false);
  });

  it('ignores hostiles outside its range', () => {
    const simulation = new Simulation(createConfig());
    parkVehicle(simulation, 0, 0);
    addStructure(simulation, 'turret', 0, 0);
    // A stationary dummy: a raider would walk into range and be shot.
    const enemy = addEnemy(simulation, TURRET_DEFENSE.range + 12, 0, 'scrap-dummy');
    simulation.world.enemies.find((e) => e.id === enemy.id)!.aiState = 'idle';

    simulation.stepMany(60 * 3);

    expect(enemy.health).toBe(enemy.maxHealth);
  });

  it('ignores a target hidden behind a rock instead of wasting ammo', () => {
    const simulation = new Simulation(createConfig());
    parkVehicle(simulation, 0, 0);
    addStructure(simulation, 'turret', 0, 0);
    const enemy = addEnemy(simulation, 14, 0, 'scrap-dummy');
    simulation.world.enemies.find((e) => e.id === enemy.id)!.aiState = 'idle';

    // A rock sits on the firing line. Turret obstacle radii come from prop
    // sizes, so an explicit circle is enough for the line-of-sight check.
    simulation.world.obstacles = [
      ...simulation.world.obstacles,
      { id: 'blocker', x: 7, y: 0, radius: 1.5 },
    ];

    simulation.stepMany(60 * 3);

    expect(enemy.health).toBe(enemy.maxHealth);
  });

  it('shoots the same target once the rock is removed', () => {
    const simulation = new Simulation(createConfig());
    parkVehicle(simulation, 0, 0);
    addStructure(simulation, 'turret', 0, 0);
    const enemy = addEnemy(simulation, 14, 0, 'scrap-dummy');
    simulation.world.enemies.find((e) => e.id === enemy.id)!.aiState = 'idle';
    simulation.world.obstacles = [
      ...simulation.world.obstacles,
      { id: 'blocker', x: 7, y: 0, radius: 1.5 },
    ];
    simulation.stepMany(60);
    expect(enemy.health).toBe(enemy.maxHealth);

    simulation.world.obstacles = simulation.world.obstacles.filter(
      (obstacle) => obstacle.id !== 'blocker',
    );
    simulation.stepMany(60 * 2);

    expect(enemy.health).toBeLessThan(enemy.maxHealth);
  });

  it('prioritises the closest hostile', () => {
    const simulation = new Simulation(createConfig());
    parkVehicle(simulation, 0, 0);
    addStructure(simulation, 'turret', 0, 0);
    const near = addEnemy(simulation, 8, 0);
    const far = addEnemy(simulation, 18, 0);

    simulation.stepMany(60 * 2);

    expect(near.health).toBeLessThan(far.health);
  });

  it('does not shoot when the turret is unpowered', () => {
    const simulation = new Simulation(createConfig());
    parkVehicle(simulation, 0, 0);
    const turret = addStructure(simulation, 'turret', 5, 0);
    // No fuel: economy takes the turret offline.
    baseOf(simulation).storage = emptyAmounts();
    const enemy = addEnemy(simulation, 12, 0, 'scrap-dummy');

    simulation.stepMany(60 * 3);

    expect(turret.active).toBe(false);
    expect(enemy.health).toBe(enemy.maxHealth);
  });

  it('never damages the player with its own rounds', () => {
    const simulation = new Simulation(createConfig());
    parkVehicle(simulation, 12, 0);

    // A base-owned round aimed straight at the parked car.
    simulation.world.projectiles.push({
      id: 9001,
      weaponId: 'base-turret',
      owner: 'base',
      kind: 'bullet',
      position: new Vec2(0, 0),
      velocity: new Vec2(60, 0),
      damage: 50,
      radius: 0.2,
      ageSeconds: 0,
      lifetimeSeconds: 2,
    });

    const before = simulation.world.vehicleHealth;
    simulation.stepMany(30);

    expect(simulation.world.vehicleHealth).toBe(before);
  });
});

describe('mines', () => {
  it('detonates when a hostile steps on it', () => {
    const simulation = new Simulation(createConfig());
    parkVehicle(simulation, 40, 40);
    moveBaseTo(simulation, 40, 40);
    addStructure(simulation, 'mine', 30, 40);
    const enemy = addEnemy(simulation, 30, 40);

    simulation.stepMany(2);

    expect(enemy.alive).toBe(false);
    expect(baseOf(simulation).structures.some((s) => s.kind === 'mine')).toBe(false);
    expect(baseOf(simulation).minesSpent).toBe(1);
  });

  it('damages every hostile inside the blast radius', () => {
    const simulation = new Simulation(createConfig());
    parkVehicle(simulation, 40, 40);
    moveBaseTo(simulation, 40, 40);
    addStructure(simulation, 'mine', 30, 40);
    const a = addEnemy(simulation, 30, 40, 'scrap-dummy');
    const b = addEnemy(simulation, 31, 40, 'heavy-dummy');

    simulation.stepMany(2);

    expect(a.health).toBeLessThan(a.maxHealth);
    expect(b.health).toBe(b.maxHealth - MINE_CONFIG.damage);
  });

  it('does not detonate without a hostile nearby', () => {
    const simulation = new Simulation(createConfig());
    parkVehicle(simulation, 0, 0);
    addStructure(simulation, 'mine', 5, 0);
    addEnemy(simulation, 30, 0);

    simulation.stepMany(60);

    expect(baseOf(simulation).structures.some((s) => s.kind === 'mine')).toBe(true);
    expect(baseOf(simulation).minesSpent).toBe(0);
  });

  it('is deterministic for the same setup', () => {
    const run = (): string => {
      const simulation = new Simulation(createConfig());
      parkVehicle(simulation, 0, 0);
      addStructure(simulation, 'mine', 5, 0);
      addStructure(simulation, 'turret', -5, 0);
      addEnemy(simulation, 8, 0);
      addEnemy(simulation, 14, 2);
      simulation.stepMany(60 * 5);
      return JSON.stringify({
        enemies: simulation.world.enemies.map((e) => ({
          hp: e.health,
          x: Math.round(e.position.x * 100) / 100,
          y: Math.round(e.position.y * 100) / 100,
        })),
        projectiles: simulation.world.projectiles.length,
      });
    };

    expect(run()).toBe(run());
  });
});

describe('sensors', () => {
  it('reports calm when nothing is in radar range', () => {
    const simulation = new Simulation(createConfig());
    parkVehicle(simulation, 0, 0);
    addEnemy(simulation, SENSOR_CONFIG.radarRadius + 20, 0);

    simulation.step();

    expect(simulation.world.sensors.level).toBe('calm');
    expect(simulation.world.sensors.nearestDistance).toBeNull();
  });

  it('reports a contact at radar range but outside attack range', () => {
    const simulation = new Simulation(createConfig());
    parkVehicle(simulation, 0, 0);
    addEnemy(simulation, SENSOR_CONFIG.attackRadius + 10, 0);

    simulation.step();

    expect(simulation.world.sensors.level).toBe('near');
    expect(simulation.world.sensors.contacts).toBe(1);
  });

  it('escalates to attack inside the attack radius', () => {
    const simulation = new Simulation(createConfig());
    parkVehicle(simulation, 0, 0);
    addEnemy(simulation, SENSOR_CONFIG.attackRadius - 3, 0);

    simulation.step();

    expect(simulation.world.sensors.level).toBe('attack');
  });

  it('raises a base alarm when hostiles approach a base', () => {
    const simulation = new Simulation(createConfig());
    const base = baseOf(simulation);
    parkVehicle(simulation, base.x, base.y);
    addEnemy(simulation, base.x + 4, base.y);

    simulation.step();

    expect(simulation.world.sensors.baseAlarm).toBe(true);
    expect(simulation.world.sensors.alarmedBaseName).toBe(base.name);
  });

  it('clears the alarm when the area is quiet', () => {
    const simulation = new Simulation(createConfig());
    parkVehicle(simulation, 0, 0);

    simulation.step();

    expect(simulation.world.sensors.baseAlarm).toBe(false);
    expect(simulation.world.sensors.alarmedBaseName).toBeNull();
  });

  it('exposes sensors in the snapshot for the HUD', () => {
    const simulation = new Simulation(createConfig());
    parkVehicle(simulation, 0, 0);
    addEnemy(simulation, 10, 0);
    simulation.step();

    const sensors = simulation.snapshot().baseState.sensors;
    expect(sensors.level).toBe('attack');
    expect(sensors.contacts).toBe(1);
  });
});
