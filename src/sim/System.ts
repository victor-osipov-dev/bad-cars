import type { SeededRandom } from '../core/math/rng';
import type { GameTime } from '../core/time/GameTime';
import type { GameplayConfig } from '../data/gameplay';
import type { VehicleConfig } from '../data/vehicles';
import type { GarageState } from './garage/GarageState';
import type { WorldState } from './world/WorldState';

/** Shared, read-only dependencies passed to every simulation system. */
export interface SimulationContext {
  readonly config: GameplayConfig;
  readonly time: GameTime;
  readonly world: WorldState;
  readonly rng: SeededRandom;
  /**
   * Vehicle configuration with garage stats applied.
   *
   * Always read this instead of `config.vehicle` for anything a garage upgrade
   * can change (top speed, acceleration, hit points, collision radius).
   */
  vehicle: VehicleConfig;
  /** Garage progression state; always the same object as `world.garage`. */
  readonly garage: GarageState;
}

export interface System {
  readonly id: string;
  update(context: SimulationContext, deltaSeconds: number): void;
}
