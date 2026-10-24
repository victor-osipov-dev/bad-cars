import { describe, expect, it } from 'vitest';
import type { EnemySpawn } from '../src/data/enemies';
import { GAME_CONFIG, type GameplayConfig } from '../src/data/gameplay';
import { SCRAP_RUNNER } from '../src/data/vehicles';
import { CANNON, MACHINE_GUN, type WeaponSlotConfig } from '../src/data/weapons';
import { Simulation } from '../src/sim/Simulation';

interface ConfigOptions {
  readonly loadout?: readonly WeaponSlotConfig[];
  readonly enemySpawns?: readonly EnemySpawn[];
}

function createConfig(options: ConfigOptions = {}): GameplayConfig {
  return {
    ...GAME_CONFIG,
    world: { ...GAME_CONFIG.world, halfWidth: 60, halfHeight: 40 },
    vehicle: {
      ...SCRAP_RUNNER,
      spawn: { x: 0, y: 0, headingRadians: 0 },
    },
    enemySpawns: options.enemySpawns ?? [
      { id: 'dummy', kind: 'scrap-dummy', x: 8, y: 0, rotation: 0 },
    ],
    loadout: options.loadout ?? [{ weaponId: MACHINE_GUN.id, reserveAmmo: 192 }],
  };
}

function stepUntil(
  simulation: Simulation,
  predicate: () => boolean,
  maxTicks = 600,
): number {
  for (let tick = 0; tick < maxTicks; tick += 1) {
    if (predicate()) return tick;
    simulation.step();
  }
  if (predicate()) return maxTicks;
  throw new Error(`condition not met within ${maxTicks} ticks`);
}

function holdPositionAndAim(
  simulation: Simulation,
  aimPoint = { x: 8, y: 0 },
  fire = true,
): void {
  simulation.queueControls({ brake: 1 }, 1);
  simulation.queueAimControls({ aimPoint, fire }, 1);
}

describe('combat simulation', () => {
  it('aims at a world point and fires on the next tick', () => {
    const simulation = new Simulation(createConfig());
    holdPositionAndAim(simulation);
    simulation.step();

    const combat = simulation.snapshot().combat;
    expect(combat.aimAngle).toBeCloseTo(0, 6);
    expect(combat.aimPoint).toEqual({ x: 8, y: 0 });
    expect(combat.weapons[0]?.ammoInMagazine).toBe(31);
    expect(combat.projectiles).toHaveLength(1);
    expect(combat.effects.some((effect) => effect.kind === 'muzzle-flash')).toBe(true);
  });

  it('follows the vehicle heading when no aim point is provided', () => {
    const simulation = new Simulation(createConfig());
    simulation.stepMany(30);

    expect(simulation.snapshot().combat.aimAngle).toBeCloseTo(0, 6);
    expect(simulation.snapshot().combat.aimPoint).toBeNull();
  });

  it('limits machine-gun shots by the fire interval', () => {
    const simulation = new Simulation(createConfig());
    holdPositionAndAim(simulation);
    simulation.stepMany(20);

    expect(simulation.snapshot().combat.weapons[0]?.ammoInMagazine).toBe(28);
  });

  it('damages and destroys a target, then respawns it', () => {
    const simulation = new Simulation(createConfig());
    holdPositionAndAim(simulation);

    stepUntil(simulation, () => simulation.world.enemies[0]?.alive === false, 300);
    expect(simulation.snapshot().combat.enemies[0]?.health).toBe(0);
    expect(simulation.world.effects.some((effect) => effect.kind === 'explosion')).toBe(true);

    const enemy = simulation.world.enemies[0];
    if (!enemy) throw new Error('missing enemy');
    const respawnTicks = stepUntil(
      simulation,
      () => simulation.world.enemies[0]?.alive === true,
      600,
    );

    expect(respawnTicks).toBeGreaterThan(300);
    expect(enemy.health).toBe(enemy.maxHealth);
    expect(enemy.position.x).toBeCloseTo(enemy.spawnX, 9);
    expect(enemy.position.y).toBeCloseTo(enemy.spawnY, 9);
  });

  it('applies cannon damage in a single hit', () => {
    const simulation = new Simulation(
      createConfig({ loadout: [{ weaponId: CANNON.id, reserveAmmo: 12 }] }),
    );
    holdPositionAndAim(simulation);
    simulation.queueAimControls({ aimPoint: { x: 8, y: 0 }, fire: false }, 2);
    simulation.stepMany(30);

    const combat = simulation.snapshot().combat;
    expect(combat.weapons[0]?.ammoInMagazine).toBe(5);
    expect(combat.enemies[0]?.health).toBe(60 - CANNON.projectile.damage);
    expect(combat.enemies[0]?.alive).toBe(true);
  });

  it('starts a manual reload from a changed reload token and uses reserve ammo', () => {
    const simulation = new Simulation(createConfig({ enemySpawns: [] }));
    holdPositionAndAim(simulation, { x: 0, y: 60 });
    simulation.stepMany(20);

    expect(simulation.snapshot().combat.weapons[0]?.ammoInMagazine).toBe(28);

    simulation.queueAimControls(
      { aimPoint: { x: 0, y: 60 }, fire: false, reloadToken: 1 },
      21,
    );
    simulation.step();
    expect(simulation.snapshot().combat.weapons[0]?.reloading).toBe(true);

    simulation.stepMany(110);
    const weapon = simulation.snapshot().combat.weapons[0];
    expect(weapon?.reloading).toBe(false);
    expect(weapon?.ammoInMagazine).toBe(MACHINE_GUN.magazineSize);
    expect(weapon?.reserveAmmo).toBe(192 - 4);
  });

  it('auto-reloads an empty magazine and consumes reserve ammo', () => {
    const simulation = new Simulation(createConfig({ enemySpawns: [] }));
    holdPositionAndAim(simulation, { x: 0, y: 60 });

    const emptyTick = stepUntil(
      simulation,
      () => simulation.snapshot().combat.weapons[0]?.ammoInMagazine === 0,
      500,
    );
    expect(emptyTick).toBeGreaterThan(100);

    stepUntil(
      simulation,
      () => simulation.snapshot().combat.weapons[0]?.reloading === true,
      100,
    );
    simulation.queueAimControls(
      { aimPoint: { x: 0, y: 60 }, fire: false },
      simulation.time.tick + 1,
    );

    stepUntil(
      simulation,
      () => simulation.snapshot().combat.weapons[0]?.reloading === false,
      300,
    );
    const weapon = simulation.snapshot().combat.weapons[0];
    expect(weapon?.ammoInMagazine).toBe(MACHINE_GUN.magazineSize);
    expect(weapon?.reserveAmmo).toBe(192 - MACHINE_GUN.magazineSize);
  });

  it('despawns projectiles after they leave the arena', () => {
    const simulation = new Simulation(createConfig({ enemySpawns: [] }));
    holdPositionAndAim(simulation, { x: 0, y: 60 });
    simulation.queueAimControls({ aimPoint: { x: 0, y: 60 }, fire: false }, 2);
    simulation.stepMany(200);

    expect(simulation.snapshot().combat.projectiles).toEqual([]);
  });

  it('is deterministic for the same commands and tick count', () => {
    const run = (): Simulation => {
      const simulation = new Simulation(createConfig());
      holdPositionAndAim(simulation);
      simulation.queueAimControls({ aimPoint: { x: -10, y: 10 } }, 120);
      simulation.stepMany(300);
      return simulation;
    };

    const first = run();
    const second = run();
    expect(first.snapshot()).toEqual(second.snapshot());
  });
});
