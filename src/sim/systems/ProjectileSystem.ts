import { ENEMY_DEFINITIONS } from '../../data/enemies';
import type { ProjectileState } from '../combat/CombatState';
import { spawnEffect } from '../combat/spawnEffect';
import { sweepCircle } from '../combat/sweepCircle';
import type { SimulationContext, System } from '../System';

/**
 * Moves projectiles with swept-circle hit detection.
 *
 * Rounds are faction-checked: player shots damage enemies, enemy shots damage
 * the player vehicle. Both still collide with solid props and arena bounds.
 * Hits resolve at the first intersection along the step, so fast bullets
 * cannot tunnel through targets.
 */
export class ProjectileSystem implements System {
  readonly id = 'projectiles';

  update(context: SimulationContext, deltaSeconds: number): void {
    const world = context.world;
    const arena = world.arena;
    const survivors: ProjectileState[] = [];

    for (const projectile of world.projectiles) {
      projectile.ageSeconds += deltaSeconds;
      if (projectile.ageSeconds > projectile.lifetimeSeconds) continue;

      const from = projectile.position;
      const to = from.add(projectile.velocity.scale(deltaSeconds));

      let hitTime: number | null = null;
      let hitEnemyIndex = -1;
      let hitPlayer = false;

      if (projectile.owner === 'player') {
        for (let index = 0; index < world.enemies.length; index += 1) {
          const enemy = world.enemies[index];
          if (!enemy || !enemy.alive) continue;
          const time = sweepCircle(
            from.x,
            from.y,
            to.x,
            to.y,
            enemy.position.x,
            enemy.position.y,
            enemy.radius + projectile.radius,
          );
          if (time !== null && (hitTime === null || time < hitTime)) {
            hitTime = time;
            hitEnemyIndex = index;
            hitPlayer = false;
          }
        }
      } else if (!world.vehicleDestroyed) {
        const vehicleRadius =
          context.config.vehicle.collision.radius + projectile.radius;
        const time = sweepCircle(
          from.x,
          from.y,
          to.x,
          to.y,
          world.vehicle.position.x,
          world.vehicle.position.y,
          vehicleRadius,
        );
        if (time !== null) {
          hitTime = time;
          hitPlayer = true;
        }
      }

      for (const obstacle of world.obstacles) {
        const time = sweepCircle(
          from.x,
          from.y,
          to.x,
          to.y,
          obstacle.x,
          obstacle.y,
          obstacle.radius + projectile.radius,
        );
        if (time !== null && (hitTime === null || time < hitTime)) {
          hitTime = time;
          hitEnemyIndex = -1;
          hitPlayer = false;
        }
      }

      const flightAngle = Math.atan2(projectile.velocity.y, projectile.velocity.x);

      if (hitTime !== null) {
        const impact = from.lerp(to, hitTime);
        if (hitPlayer) {
          world.vehicleHealth = Math.max(0, world.vehicleHealth - projectile.damage);
          spawnEffect(world, 'hit-spark', impact.x, impact.y, flightAngle);

          if (world.vehicleHealth <= 0) {
            world.vehicleDestroyed = true;
            world.vehicleRespawnRemainingSeconds =
              context.config.vehicle.durability.respawnSeconds;
            spawnEffect(world, 'explosion', world.vehicle.position.x, world.vehicle.position.y, 0);
            spawnEffect(world, 'debris', world.vehicle.position.x, world.vehicle.position.y, 0.9);
          }
        } else if (hitEnemyIndex >= 0) {
          const enemy = world.enemies[hitEnemyIndex];
          if (enemy) {
            enemy.health = Math.max(0, enemy.health - projectile.damage);
            spawnEffect(world, 'hit-spark', impact.x, impact.y, flightAngle);

            if (enemy.health <= 0) {
              enemy.alive = false;
              enemy.respawnRemainingSeconds =
                ENEMY_DEFINITIONS[enemy.kind].respawnSeconds;
              spawnEffect(world, 'explosion', enemy.position.x, enemy.position.y, 0);
              spawnEffect(world, 'debris', enemy.position.x, enemy.position.y, 0.6);
            }
          }
        } else {
          spawnEffect(world, 'hit-spark', impact.x, impact.y, flightAngle);
        }
        continue;
      }

      if (Math.abs(to.x) > arena.halfWidth || Math.abs(to.y) > arena.halfHeight) {
        const clampX = Math.min(arena.halfWidth, Math.max(-arena.halfWidth, to.x));
        const clampY = Math.min(arena.halfHeight, Math.max(-arena.halfHeight, to.y));
        spawnEffect(world, 'debris', clampX, clampY, flightAngle);
        continue;
      }

      projectile.position = to;
      survivors.push(projectile);
    }

    world.projectiles = survivors;
  }
}
