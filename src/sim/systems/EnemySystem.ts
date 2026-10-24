import { wrapAngle } from '../../core/math/angle';
import { moveTowards } from '../../core/math/scalar';
import { Vec2 } from '../../core/math/Vec2';
import { ENEMY_DEFINITIONS, type EnemyWeaponConfig } from '../../data/enemies';
import type { EnemyState } from '../combat/CombatState';
import { spawnEffect } from '../combat/spawnEffect';
import type { SimulationContext, System } from '../System';

/**
 * Hostile turrets: track the player, fire when in range, and respawn wrecks.
 *
 * Deterministic: aim depends only on positions, cooldowns tick with the fixed
 * step, and the only randomness is one seeded spread draw per shot.
 */
export class EnemySystem implements System {
  readonly id = 'enemies';

  update(context: SimulationContext, deltaSeconds: number): void {
    const world = context.world;
    const vehicle = world.vehicle;

    for (const enemy of world.enemies) {
      if (!enemy.alive) {
        this.#tickRespawn(enemy, deltaSeconds);
        continue;
      }

      const weapon = ENEMY_DEFINITIONS[enemy.kind].weapon;
      if (!weapon) continue;

      if (enemy.fireCooldownSeconds > 0) {
        enemy.fireCooldownSeconds = Math.max(
          0,
          enemy.fireCooldownSeconds - deltaSeconds,
        );
      }

      // A wrecked player is not a target, so turrets hold fire during respawn.
      if (world.vehicleDestroyed) continue;

      const deltaX = vehicle.position.x - enemy.position.x;
      const deltaY = vehicle.position.y - enemy.position.y;
      const distanceSquared = deltaX * deltaX + deltaY * deltaY;
      if (distanceSquared > weapon.range * weapon.range) continue;

      const targetAngle = Math.atan2(deltaY, deltaX);
      enemy.rotation = wrapAngle(
        moveTowards(
          wrapAngle(enemy.rotation),
          targetAngle,
          weapon.turnRateRadians * deltaSeconds,
        ),
      );

      // Only shoot once the turret is roughly on target.
      const angleError = Math.abs(wrapAngle(targetAngle - enemy.rotation));
      if (angleError > 0.12) continue;
      if (enemy.fireCooldownSeconds > 0) continue;

      this.#fire(context, enemy, targetAngle, weapon);
    }
  }

  #tickRespawn(enemy: EnemyState, deltaSeconds: number): void {
    enemy.respawnRemainingSeconds = Math.max(
      0,
      enemy.respawnRemainingSeconds - deltaSeconds,
    );
    if (enemy.respawnRemainingSeconds > 0) return;

    enemy.alive = true;
    enemy.health = enemy.maxHealth;
    enemy.position = new Vec2(enemy.spawnX, enemy.spawnY);
    enemy.fireCooldownSeconds = 0;
  }

  #fire(
    context: SimulationContext,
    enemy: EnemyState,
    targetAngle: number,
    weapon: EnemyWeaponConfig,
  ): void {
    const world = context.world;
    const spread =
      weapon.spreadRadians > 0
        ? context.rng.range(-weapon.spreadRadians, weapon.spreadRadians)
        : 0;
    const angle = wrapAngle(targetAngle + spread);
    const direction = Vec2.fromAngle(angle);
    const muzzle = enemy.position.add(direction.scale(weapon.muzzleOffset));

    world.projectiles.push({
      id: world.nextProjectileId,
      weaponId: `enemy:${enemy.kind}`,
      owner: 'enemy',
      kind: 'bullet',
      position: muzzle,
      velocity: direction.scale(weapon.projectileSpeed),
      damage: weapon.damage,
      radius: weapon.projectileRadius,
      ageSeconds: 0,
      lifetimeSeconds: weapon.projectileLifetimeSeconds,
    });
    world.nextProjectileId += 1;
    enemy.fireCooldownSeconds = weapon.fireIntervalSeconds;

    spawnEffect(world, 'muzzle-flash', muzzle.x, muzzle.y, angle);
  }
}
