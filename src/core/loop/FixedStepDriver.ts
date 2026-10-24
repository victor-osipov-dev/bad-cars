import type { GameTime } from '../time/GameTime';

export interface FixedStepDriverOptions {
  /** Upper bound on simulation steps per rendered frame. Defaults to 8. */
  readonly maxSubSteps?: number;
  /** Upper bound on real time accepted from a single frame. Defaults to 0.25 s. */
  readonly maxFrameDeltaSeconds?: number;
}

export interface FixedStepResult {
  /** Number of simulation steps executed during this advance. */
  readonly steps: number;
  /** Interpolation alpha in [0, 1): accumulator / step. */
  readonly alpha: number;
  /** Simulation time deliberately discarded this call to avoid a spiral. */
  readonly droppedSeconds: number;
  /** Time left in the accumulator after stepping. */
  readonly accumulatorSeconds: number;
}

const EPSILON = 1e-9;

/**
 * Converts variable real-frame deltas into fixed simulation steps.
 *
 * The driver is a scheduler: it counts due ticks but does not mutate the
 * clock or the world itself. Each `onStep` call must advance the simulation
 * exactly once (typically `simulation.step()`), which owns time progression.
 *
 * Both the accepted frame delta and the number of steps per frame are capped.
 * Any whole steps still pending after the cap are dropped and counted, so a
 * slow tab can never trigger an unbounded catch-up loop.
 */
export class FixedStepDriver {
  readonly time: GameTime;
  readonly maxSubSteps: number;
  readonly maxFrameDeltaSeconds: number;

  #accumulatorSeconds = 0;
  #droppedSecondsTotal = 0;

  constructor(time: GameTime, options: FixedStepDriverOptions = {}) {
    const { maxSubSteps = 8, maxFrameDeltaSeconds = 0.25 } = options;

    if (!Number.isInteger(maxSubSteps) || maxSubSteps < 1) {
      throw new RangeError('maxSubSteps must be an integer >= 1');
    }
    if (!Number.isFinite(maxFrameDeltaSeconds) || maxFrameDeltaSeconds <= 0) {
      throw new RangeError('maxFrameDeltaSeconds must be a finite positive number');
    }

    this.time = time;
    this.maxSubSteps = maxSubSteps;
    this.maxFrameDeltaSeconds = maxFrameDeltaSeconds;
  }

  get accumulatorSeconds(): number {
    return this.#accumulatorSeconds;
  }

  get droppedSecondsTotal(): number {
    return this.#droppedSecondsTotal;
  }

  /**
   * Feeds real elapsed time into the accumulator and invokes `onStep` for every
   * due fixed tick. The callback owns simulation and clock advancement.
   */
  advance(frameDeltaSeconds: number, onStep?: () => void): FixedStepResult {
    const step = this.time.fixedStepSeconds;
    const acceptedDelta = Number.isFinite(frameDeltaSeconds)
      ? Math.min(Math.max(frameDeltaSeconds, 0), this.maxFrameDeltaSeconds)
      : 0;

    this.#accumulatorSeconds += acceptedDelta;

    let steps = 0;
    while (this.#accumulatorSeconds + EPSILON >= step && steps < this.maxSubSteps) {
      this.#accumulatorSeconds -= step;
      steps += 1;
      onStep?.();
    }

    let droppedSeconds = 0;
    if (this.#accumulatorSeconds + EPSILON >= step) {
      const droppedSteps = Math.floor((this.#accumulatorSeconds + EPSILON) / step);
      droppedSeconds = droppedSteps * step;
      this.#accumulatorSeconds = Math.max(0, this.#accumulatorSeconds - droppedSeconds);
      this.#droppedSecondsTotal += droppedSeconds;
    }

    if (this.#accumulatorSeconds < 0) {
      this.#accumulatorSeconds = 0;
    }

    const alpha = Math.min(1, Math.max(0, this.#accumulatorSeconds / step));

    return {
      steps,
      alpha,
      droppedSeconds,
      accumulatorSeconds: this.#accumulatorSeconds,
    };
  }

  /** Clears the accumulator and dropped-time counter. Does not reset the clock. */
  reset(): void {
    this.#accumulatorSeconds = 0;
    this.#droppedSecondsTotal = 0;
  }
}
