import { wrapAngle } from '../../core/math/angle';
import { Vec2 } from '../../core/math/Vec2';
import type { SimulationContext, System } from '../System';

/**
 * Wreck recovery.
 *
 * While `vehicleDestroyed` is set the car is frozen (the movement system skips
 * it) and a countdown runs; when it expires the car respawns at its configured
 * spawn with full health. Kept separate from movement so durability rules stay
 * testable and independent of the driving model.
 */
export class VehicleDurabilitySystem implements System {
  readonly id = 'vehicle-durability';

  update(context: SimulationContext, deltaSeconds: number): void {
    const world = context.world;
    if (!world.vehicleDestroyed) return;

    world.vehicleRespawnRemainingSeconds = Math.max(
      0,
      world.vehicleRespawnRemainingSeconds - deltaSeconds,
    );
    if (world.vehicleRespawnRemainingSeconds > 0) return;

    const { spawn } = context.config.vehicle;
    world.vehicle = {
      position: new Vec2(spawn.x, spawn.y),
      velocity: Vec2.ZERO,
      heading: wrapAngle(spawn.headingRadians),
      steering: 0,
    };
    world.vehicleHealth = context.config.vehicle.durability.maxHealth;
    world.vehicleDestroyed = false;
  }
}
