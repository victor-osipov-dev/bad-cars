import { rotateTowards, wrapAngle } from '../../core/math/angle';
import { Vec2 } from '../../core/math/Vec2';
import { ENEMY_DEFINITIONS } from '../../data/enemies';
import {
  MINE_CONFIG,
  TURRET_DEFENSE,
  type MineConfig,
  type TurretDefenseConfig,
} from '../../data/defense';
import type { BaseState, StructureState } from '../base/BaseState';
import { isSegmentBlocked } from '../combat/sweepCircle';
import { spawnEffect } from '../combat/spawnEffect';
import type { EnemyState } from '../combat/CombatState';
import type { SimulationContext, System } from '../System';

function distanceSquared(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

/**
 * Automated base defence: turrets and mines.
 *
 * Turrets pick the closest living hostile inside their range, slew toward it
 * with a rate limit and fire once aligned. Mines detonate when any hostile
 * enters the trigger radius, damaging everything inside the blast. Both are
 * deterministic: target choice is distance-ordered, and the only randomness
 * is the seeded spread on turret shots.
 */
export class DefenseSystem implements System {
  readonly id = 'defense';
  readonly #turret: TurretDefenseConfig;
  readonly #mine: MineConfig;

  constructor(
    turret: TurretDefenseConfig = TURRET_DEFENSE,
    mine: MineConfig = MINE_CONFIG,
  ) {
    this.#turret = turret;
    this.#mine = mine;
  }

  update(context: SimulationContext, deltaSeconds: number): void {
    const world = context.world;

    for (const base of world.bases) {
      this.#updateTurrets(context, base, deltaSeconds);
      this.#updateMines(context, base);
    }
  }

  #updateTurrets(
    context: SimulationContext,
    base: BaseState,
    deltaSeconds: number,
  ): void {
    const rangeSquared = this.#turret.range * this.#turret.range;

    for (const structure of base.structures) {
      if (structure.kind !== 'turret' || !structure.active) continue;

      structure.cooldownSeconds = Math.max(
        0,
        structure.cooldownSeconds - deltaSeconds,
      );

      const target = this.#nearestEnemy(context, structure, rangeSquared);
      if (!target) continue;

      const targetAngle = Math.atan2(
        target.position.y - structure.y,
        target.position.x - structure.x,
      );
      structure.aimAngle = rotateTowards(
        structure.aimAngle,
        targetAngle,
        this.#turret.turnRateRadians * deltaSeconds,
      );

      if (structure.cooldownSeconds > 0) continue;

      const error = Math.abs(wrapAngle(targetAngle - structure.aimAngle));
      if (error > this.#turret.aimTolerance) continue;

      this.#fire(context, structure, targetAngle);
    }
  }

  #nearestEnemy(
    context: SimulationContext,
    structure: StructureState,
    rangeSquared: number,
  ): EnemyState | null {
    let best: EnemyState | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const enemy of context.world.enemies) {
      if (!enemy.alive) continue;
      const distance = distanceSquared(structure.x, structure.y, enemy.position.x, enemy.position.y);
      if (distance > rangeSquared) continue;

      // Skip targets hidden behind a rock: rounds would just shatter on it.
      if (
        isSegmentBlocked(
          structure.x,
          structure.y,
          enemy.position.x,
          enemy.position.y,
          context.world.obstacles,
          this.#turret.projectileRadius + 0.15,
        )
      ) {
        continue;
      }

      // Prefer the closest target; ties resolve by list order, which is stable.
      if (distance < bestDistance) {
        bestDistance = distance;
        best = enemy;
      }
    }

    return best;
  }

  #fire(
    context: SimulationContext,
    structure: StructureState,
    angle: number,
  ): void {
    const world = context.world;
    const direction = Vec2.fromAngle(angle);
    const muzzle = new Vec2(
      structure.x + direction.x * this.#turret.muzzleOffset,
      structure.y + direction.y * this.#turret.muzzleOffset,
    );

    world.projectiles.push({
      id: world.nextProjectileId,
      weaponId: 'base-turret',
      owner: 'base',
      kind: 'bullet',
      position: muzzle,
      velocity: direction.scale(this.#turret.projectileSpeed),
      damage: this.#turret.damage,
      radius: this.#turret.projectileRadius,
      ageSeconds: 0,
      lifetimeSeconds: this.#turret.projectileLifetimeSeconds,
    });
    world.nextProjectileId += 1;
    structure.cooldownSeconds = this.#turret.fireIntervalSeconds;

    spawnEffect(world, 'muzzle-flash', muzzle.x, muzzle.y, angle);
  }

  #updateMines(context: SimulationContext, base: BaseState): void {
    const world = context.world;
    const remaining: StructureState[] = [];

    for (const structure of base.structures) {
      if (structure.kind !== 'mine') {
        remaining.push(structure);
        continue;
      }

      const triggered = world.enemies.some(
        (enemy) =>
          enemy.alive &&
          distanceSquared(
            structure.x,
            structure.y,
            enemy.position.x,
            enemy.position.y,
          ) <=
            this.#mine.triggerRadius * this.#mine.triggerRadius,
      );

      if (!triggered) {
        remaining.push(structure);
        continue;
      }

      // Detonate: friendly structures are unaffected, only hostiles take damage.
      const blastSquared = this.#mine.blastRadius * this.#mine.blastRadius;
      for (const enemy of world.enemies) {
        if (!enemy.alive) continue;
        if (
          distanceSquared(structure.x, structure.y, enemy.position.x, enemy.position.y) >
          blastSquared
        ) {
          continue;
        }
        enemy.health = Math.max(0, enemy.health - this.#mine.damage);
        if (enemy.health <= 0) {
          enemy.alive = false;
          // Use the kind's respawn delay: leaving this at 0 revived the target
          // on the very next tick, making mines look like they did no damage.
          enemy.respawnRemainingSeconds =
            ENEMY_DEFINITIONS[enemy.kind].respawnSeconds;
        }
      }

      spawnEffect(world, 'explosion', structure.x, structure.y, 0);
      spawnEffect(world, 'debris', structure.x, structure.y, 0.5);
      base.minesSpent += 1;
    }

    if (remaining.length !== base.structures.length) {
      base.structures = remaining;
    }
  }
}
