import { stepVehicle } from '../vehicle/stepVehicle';
import type { SimulationContext, System } from '../System';

/**
 * Applies the current drive controls to the vehicle once per fixed tick.
 * A wrecked car does not move; `VehicleDurabilitySystem` owns recovery.
 */
export class VehicleMovementSystem implements System {
  readonly id = 'vehicle-movement';

  update(context: SimulationContext, deltaSeconds: number): void {
    const world = context.world;
    if (world.vehicleDestroyed) return;
    world.vehicle = stepVehicle(world.vehicle, {
      config: context.config.vehicle,
      arena: world.arena,
      obstacles: world.obstacles,
      controls: world.controls,
      deltaSeconds,
    });
  }
}
