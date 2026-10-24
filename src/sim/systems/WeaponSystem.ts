import { wrapAngle } from '../../core/math/angle';
import { Vec2 } from '../../core/math/Vec2';
import { WEAPON_CONFIGS, type WeaponConfig } from '../../data/weapons';
import { spawnEffect } from '../combat/spawnEffect';
import type { WeaponSlotState } from '../combat/CombatState';
import type { SimulationContext, System } from '../System';

/**
 * Turret aim, weapon cooldowns, ammunition and reloads.
 *
 * Aim/fire commands are absolute world positions and booleans, so firing is
 * deterministic. Spread is the only random factor and comes from the seeded
 * RNG, one draw per shot.
 */
export class WeaponSystem implements System {
  readonly id = 'weapons';

  update(context: SimulationContext, deltaSeconds: number): void {
    const world = context.world;
    const combat = world.combat;
    const vehicle = world.vehicle;

    const slotCount = combat.weapons.length;
    const requestedSlot = world.aim.activeSlot;
    const activeSlot = slotCount > 0 ? Math.min(slotCount - 1, requestedSlot) : 0;
    combat.activeSlot = activeSlot;

    const aimPoint = world.aim.aimPoint;
    combat.aimPoint = aimPoint ? new Vec2(aimPoint.x, aimPoint.y) : null;
    if (aimPoint) {
      const deltaX = aimPoint.x - vehicle.position.x;
      const deltaY = aimPoint.y - vehicle.position.y;
      if (deltaX * deltaX + deltaY * deltaY > 0.0625) {
        combat.aimAngle = wrapAngle(Math.atan2(deltaY, deltaX));
      }
    } else {
      combat.aimAngle = vehicle.heading;
    }

    for (const slot of combat.weapons) {
      const config = WEAPON_CONFIGS[slot.weaponId];
      if (!config) continue;

      if (slot.cooldownSeconds > 0) {
        slot.cooldownSeconds = Math.max(0, slot.cooldownSeconds - deltaSeconds);
      }

      if (slot.reloadRemainingSeconds > 0) {
        slot.reloadRemainingSeconds = Math.max(
          0,
          slot.reloadRemainingSeconds - deltaSeconds,
        );
        if (slot.reloadRemainingSeconds === 0) {
          this.#finishReload(slot, config);
        }
      }
    }

    const slot = combat.weapons[activeSlot];
    if (!slot) return;
    const config = WEAPON_CONFIGS[slot.weaponId];
    if (!config) return;

    if (world.aim.reloadToken !== combat.lastReloadToken) {
      combat.lastReloadToken = world.aim.reloadToken;
      this.#tryStartReload(slot, config);
    }

    if (
      world.aim.fire &&
      slot.reloadRemainingSeconds === 0 &&
      slot.cooldownSeconds === 0
    ) {
      if (slot.ammoInMagazine > 0) {
        this.#fire(context, config, slot);
      } else {
        this.#tryStartReload(slot, config);
      }
    }
  }

  #fire(context: SimulationContext, config: WeaponConfig, slot: WeaponSlotState): void {
    const world = context.world;
    const combat = world.combat;
    const spread =
      config.spreadRadians > 0
        ? context.rng.range(-config.spreadRadians, config.spreadRadians)
        : 0;
    const angle = wrapAngle(combat.aimAngle + spread);
    const direction = Vec2.fromAngle(angle);
    const muzzle = world.vehicle.position.add(direction.scale(config.muzzleOffset));

    world.projectiles.push({
      id: world.nextProjectileId,
      weaponId: config.id,
      owner: 'player',
      kind: config.projectileKind,
      position: muzzle,
      velocity: direction.scale(config.projectile.speed),
      damage: config.projectile.damage,
      radius: config.projectile.radius,
      ageSeconds: 0,
      lifetimeSeconds: config.projectile.lifetimeSeconds,
    });
    world.nextProjectileId += 1;

    slot.ammoInMagazine -= 1;
    slot.cooldownSeconds = config.fireIntervalSeconds;

    spawnEffect(world, 'muzzle-flash', muzzle.x, muzzle.y, angle);
  }

  #tryStartReload(slot: WeaponSlotState, config: WeaponConfig): void {
    if (slot.reloadRemainingSeconds > 0) return;
    if (slot.ammoInMagazine >= config.magazineSize) return;
    if (slot.reserveAmmo <= 0) return;
    slot.reloadRemainingSeconds = config.reloadSeconds;
  }

  #finishReload(slot: WeaponSlotState, config: WeaponConfig): void {
    const needed = config.magazineSize - slot.ammoInMagazine;
    const loaded = Math.min(needed, slot.reserveAmmo);
    slot.ammoInMagazine += loaded;
    slot.reserveAmmo -= loaded;
  }
}
