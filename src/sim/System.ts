import type { SeededRandom } from '../core/math/rng';
import type { GameTime } from '../core/time/GameTime';
import type { GameplayConfig } from '../data/gameplay';
import type { WorldState } from './world/WorldState';

/** Shared, read-only dependencies passed to every simulation system. */
export interface SimulationContext {
  readonly config: GameplayConfig;
  readonly time: GameTime;
  readonly world: WorldState;
  readonly rng: SeededRandom;
}

export interface System {
  readonly id: string;
  update(context: SimulationContext, deltaSeconds: number): void;
}
