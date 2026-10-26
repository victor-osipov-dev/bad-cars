import { rotateTowards, wrapAngle } from '../../core/math/angle';
import { Vec2 } from '../../core/math/Vec2';
import {
  ENEMY_AI_CONFIG,
  ENEMY_DEFINITIONS,
  type EnemyAIConfig,
  type EnemyAIConfigGlobal,
  type EnemyWeaponConfig,
} from '../../data/enemies';
import type { EnemyState } from '../combat/CombatState';
import { spawnEffect } from '../combat/spawnEffect';
import type { ObstacleCircle } from '../vehicle/VehicleState';
import type { SimulationContext, System } from '../System';

/** Extra clearance kept from props while moving. */
const PROP_CLEARANCE = 0.25;

function distance(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Pushes a moving enemy out of any prop it overlaps and returns the corrected
 * position. Enemy movement is kinematic (no physics body), so a simple
 * push-out is enough to stop them sinking into rocks.
 */
function resolveProps(
  x: number,
  y: number,
  radius: number,
  obstacles: readonly ObstacleCircle[],
): { x: number; y: number; blocked: boolean } {
  let outX = x;
  let outY = y;
  let blocked = false;

  for (const obstacle of obstacles) {
    const dx = outX - obstacle.x;
    const dy = outY - obstacle.y;
    const minDistance = radius + obstacle.radius + PROP_CLEARANCE;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared >= minDistance * minDistance) continue;

    blocked = true;
    const length = Math.sqrt(distanceSquared);
    if (length < 1e-6) {
      outX = obstacle.x + minDistance;
      outY = obstacle.y;
      continue;
    }
    outX = obstacle.x + (dx / length) * minDistance;
    outY = obstacle.y + (dy / length) * minDistance;
  }

  return { x: outX, y: outY, blocked };
}

/**
 * Hostile AI.
 *
 * Stationary kinds (`scrap-dummy`, `heavy-dummy`) behave as before: they aim,
 * fire in range and respawn after a timer. Mobile `raider`s patrol their home
 * circle, notice the player, chase, shoot when close, break off when leashed or
 * stalled, and are spawned/despawned by a global budget so the AI cost stays
 * bounded no matter how far the player drives.
 */
export class EnemySystem implements System {
  readonly id = 'enemies';
  readonly #config: EnemyAIConfigGlobal;
  #spawnCooldown = 0;

  constructor(config: EnemyAIConfigGlobal = ENEMY_AI_CONFIG) {
    this.#config = config;
  }

  update(context: SimulationContext, deltaSeconds: number): void {
    const world = context.world;

    this.#despawnFarEnemies(context);

    for (const enemy of world.enemies) {
      if (!enemy.alive) {
        this.#tickRespawn(enemy, deltaSeconds);
        continue;
      }
      this.#updateEnemy(context, enemy, deltaSeconds);
    }

    this.#spawn(context, deltaSeconds);
  }

  #updateEnemy(
    context: SimulationContext,
    enemy: EnemyState,
    deltaSeconds: number,
  ): void {
    const definition = ENEMY_DEFINITIONS[enemy.kind];
    const ai = definition.ai;

    enemy.stateSeconds += deltaSeconds;

    if (enemy.fireCooldownSeconds > 0) {
      enemy.fireCooldownSeconds = Math.max(0, enemy.fireCooldownSeconds - deltaSeconds);
    }

    if (ai.behaviour === 'stationary') {
      this.#updateStationary(context, enemy, ai, deltaSeconds);
      return;
    }

    this.#updateMobile(context, enemy, ai, deltaSeconds);
  }

  /** Dummies and base turrets: hold position, aim and fire when in range. */
  #updateStationary(
    context: SimulationContext,
    enemy: EnemyState,
    ai: EnemyAIConfig,
    deltaSeconds: number,
  ): void {
    const weapon = ENEMY_DEFINITIONS[enemy.kind].weapon;
    if (!weapon || context.world.vehicleDestroyed) return;

    const { x, y } = context.world.vehicle.position;
    const range = distance(enemy.position.x, enemy.position.y, x, y);
    if (range > ai.detectionRadius) return;

    // `rotateTowards` follows the shortest arc; plain moveTowards would spin
    // the turret the long way round when the target lies across ±PI.
    enemy.rotation = rotateTowards(
      enemy.rotation,
      Math.atan2(y - enemy.position.y, x - enemy.position.x),
      weapon.turnRateRadians * deltaSeconds,
    );
    enemy.aimAngle = enemy.rotation;

    const targetAngle = Math.atan2(y - enemy.position.y, x - enemy.position.x);
    const angleError = Math.abs(wrapAngle(targetAngle - enemy.rotation));
    if (angleError > 0.12 || enemy.fireCooldownSeconds > 0) return;

    this.#fire(context, enemy, targetAngle, weapon);
  }

  #updateMobile(
    context: SimulationContext,
    enemy: EnemyState,
    ai: EnemyAIConfig,
    deltaSeconds: number,
  ): void {
    const world = context.world;
    const blocker = world.vehicleDestroyed ? null : world.vehicle;
    const playerDistance = blocker
      ? distance(
          enemy.position.x,
          enemy.position.y,
          blocker.position.x,
          blocker.position.y,
        )
      : Number.POSITIVE_INFINITY;
    const homeDistance = distance(
      enemy.position.x,
      enemy.position.y,
      enemy.spawnX,
      enemy.spawnY,
    );

    switch (enemy.aiState) {
      case 'patrol': {
        this.#patrol(enemy, ai, deltaSeconds);
        if (playerDistance <= ai.detectionRadius) this.#enter(enemy, 'chase');
        break;
      }
      case 'chase': {
        if (!blocker) {
          this.#enter(enemy, 'return');
          break;
        }

        // Track real progress: `bestDistance` only drops when the enemy
        // meaningfully closes in, so hovering in place counts as a stall.
        if (playerDistance < enemy.bestDistance - 0.25) {
          enemy.bestDistance = playerDistance;
          enemy.stallSeconds = 0;
        } else {
          enemy.stallSeconds += deltaSeconds;
        }

        if (homeDistance > ai.leashRadius) {
          this.#enter(enemy, 'return');
          break;
        }
        if (playerDistance <= ai.preferredRange) {
          this.#enter(enemy, 'attack');
          break;
        }
        if (enemy.stateSeconds > ai.chaseTimeoutSeconds) {
          this.#enter(enemy, 'return');
          break;
        }
        // Stalled against a prop or a wall: no progress for a third of the
        // timeout budget is enough to give up instead of grinding forever.
        if (
          enemy.stateSeconds > ai.chaseTimeoutSeconds / 3 &&
          enemy.stallSeconds > ai.chaseTimeoutSeconds / 3
        ) {
          this.#enter(enemy, 'return');
          break;
        }

        this.#move(enemy, blocker.position.x, blocker.position.y, ai.chaseSpeed, deltaSeconds, world);
        break;
      }
      case 'attack': {
        if (!blocker) {
          this.#enter(enemy, 'return');
          break;
        }

        this.#aim(enemy, blocker.position.x, blocker.position.y, deltaSeconds);
        enemy.rotation = enemy.aimAngle;

        const weapon = ENEMY_DEFINITIONS[enemy.kind].weapon;
        if (weapon && playerDistance <= weapon.range && enemy.fireCooldownSeconds <= 0) {
          const targetAngle = Math.atan2(
            blocker.position.y - enemy.position.y,
            blocker.position.x - enemy.position.x,
          );
          const angleError = Math.abs(wrapAngle(targetAngle - enemy.rotation));
          if (angleError < 0.2) this.#fire(context, enemy, targetAngle, weapon);
        }

        if (playerDistance > ai.preferredRange * 1.6) this.#enter(enemy, 'chase');
        else if (homeDistance > ai.leashRadius) this.#enter(enemy, 'return');
        break;
      }
      case 'return': {
        this.#move(enemy, enemy.spawnX, enemy.spawnY, ai.patrolSpeed, deltaSeconds, world);
        enemy.rotation = wrapAngle(enemy.rotation);
        if (homeDistance < 1.5) {
          enemy.patrolAngle = enemy.rotation;
          this.#enter(enemy, 'patrol');
        }
        break;
      }
      default: {
        this.#enter(enemy, 'patrol');
        break;
      }
    }
  }

  #enter(enemy: EnemyState, state: EnemyState['aiState']): void {
    if (enemy.aiState === state) return;
    enemy.aiState = state;
    enemy.stateSeconds = 0;
    if (state === 'chase') {
      enemy.bestDistance = Number.POSITIVE_INFINITY;
      enemy.stallSeconds = 0;
    }
  }

  /** Walks a slow circle around home; never needs pathfinding. */
  #patrol(enemy: EnemyState, ai: EnemyAIConfig, deltaSeconds: number): void {
    const radius = Math.max(1, ai.patrolRadius);
    enemy.patrolAngle = wrapAngle(
      enemy.patrolAngle + (ai.patrolSpeed / radius) * deltaSeconds,
    );
    const targetX = enemy.spawnX + Math.cos(enemy.patrolAngle) * radius;
    const targetY = enemy.spawnY + Math.sin(enemy.patrolAngle) * radius;
    this.#move(enemy, targetX, targetY, ai.patrolSpeed, deltaSeconds, undefined);
  }

  #aim(enemy: EnemyState, x: number, y: number, deltaSeconds: number): void {
    const weapon = ENEMY_DEFINITIONS[enemy.kind].weapon;
    if (!weapon) return;
    const targetAngle = Math.atan2(y - enemy.position.y, x - enemy.position.x);
    enemy.aimAngle = rotateTowards(
      enemy.aimAngle,
      targetAngle,
      weapon.turnRateRadians * deltaSeconds,
    );
  }

  #move(
    enemy: EnemyState,
    targetX: number,
    targetY: number,
    speed: number,
    deltaSeconds: number,
    world: SimulationContext['world'] | undefined,
  ): void {
    const dx = targetX - enemy.position.x;
    const dy = targetY - enemy.position.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length < 1e-6 || speed <= 0) return;

    const step = Math.min(speed * deltaSeconds, length);
    const nextX = enemy.position.x + (dx / length) * step;
    const nextY = enemy.position.y + (dy / length) * step;

    const obstacles = world?.obstacles ?? [];
    const resolved = resolveProps(nextX, nextY, enemy.radius, obstacles);

    // Stay inside the world bounds.
    const halfWidth = world?.arena.halfWidth ?? 1e9;
    const halfHeight = world?.arena.halfHeight ?? 1e9;
    enemy.position = new Vec2(
      Math.min(Math.max(resolved.x, -halfWidth), halfWidth),
      Math.min(Math.max(resolved.y, -halfHeight), halfHeight),
    );

    const heading = Math.atan2(dy, dx);
    enemy.rotation = wrapAngle(heading);
  }

  #tickRespawn(enemy: EnemyState, deltaSeconds: number): void {
    const definition = ENEMY_DEFINITIONS[enemy.kind];
    if (definition.respawnSeconds <= 0) return;

    enemy.respawnRemainingSeconds = Math.max(
      0,
      enemy.respawnRemainingSeconds - deltaSeconds,
    );
    if (enemy.respawnRemainingSeconds > 0) return;

    enemy.alive = true;
    enemy.health = enemy.maxHealth;
    enemy.position = new Vec2(enemy.spawnX, enemy.spawnY);
    enemy.fireCooldownSeconds = 0;
    enemy.stateSeconds = 0;
    enemy.aiState = definition.ai.behaviour === 'patrol' ? 'patrol' : 'idle';
  }

  #despawnFarEnemies(context: SimulationContext): void {
    const world = context.world;
    const { x, y } = world.vehicle.position;
    const limit = this.#config.despawnRadius;

    world.enemies = world.enemies.filter((enemy) => {
      if (ENEMY_DEFINITIONS[enemy.kind].ai.behaviour === 'stationary') return true;
      return distance(enemy.position.x, enemy.position.y, x, y) <= limit;
    });
  }

  #spawn(context: SimulationContext, deltaSeconds: number): void {
    const world = context.world;
    const mobile = world.enemies.filter(
      (enemy) => ENEMY_DEFINITIONS[enemy.kind].ai.behaviour === 'patrol',
    ).length;

    if (mobile >= this.#config.maxMobileEnemies) {
      this.#spawnCooldown = 0;
      return;
    }

    this.#spawnCooldown += deltaSeconds;
    if (this.#spawnCooldown < this.#config.spawnIntervalSeconds) return;
    this.#spawnCooldown = 0;

    const angle = context.rng.range(-Math.PI, Math.PI);
    const radius = context.rng.range(
      this.#config.spawnRadiusMin,
      this.#config.spawnRadiusMax,
    );
    const spawnX = world.vehicle.position.x + Math.cos(angle) * radius;
    const spawnY = world.vehicle.position.y + Math.sin(angle) * radius;

    // Keep spawns inside the world and out of props.
    if (
      Math.abs(spawnX) > world.arena.halfWidth - 2 ||
      Math.abs(spawnY) > world.arena.halfHeight - 2
    ) {
      return;
    }
    const resolved = resolveProps(spawnX, spawnY, 1.2, world.obstacles);
    if (resolved.blocked) return;

    const definition = ENEMY_DEFINITIONS.raider;
    world.enemies.push({
      id: `raider-${world.nextEnemyId}`,
      kind: 'raider',
      spawnX,
      spawnY,
      rotation: angle + Math.PI,
      aimAngle: angle + Math.PI,
      radius: definition.radius,
      maxHealth: definition.maxHealth,
      position: new Vec2(spawnX, spawnY),
      health: definition.maxHealth,
      alive: true,
      respawnRemainingSeconds: 0,
      fireCooldownSeconds: definition.weapon?.fireIntervalSeconds ?? 0,
      aiState: 'patrol',
      stateSeconds: 0,
      bestDistance: Number.POSITIVE_INFINITY,
      stallSeconds: 0,
      patrolAngle: angle,
      raidId: null,
    });
    world.nextEnemyId += 1;
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
