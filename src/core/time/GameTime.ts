export interface GameTimeOptions {
  /** Fixed simulation step, in seconds. Must be > 0. */
  readonly fixedStepSeconds: number;
  /** Length of one in-game day, in simulation seconds. Must be > 0. */
  readonly dayLengthSeconds: number;
  /** Initial tick, useful for loading a save. Defaults to 0. */
  readonly startTick?: number;
}

/**
 * Simulation clock. Time is always derived from the integer tick counter so
 * repeated stepping cannot accumulate floating-point drift.
 */
export class GameTime {
  readonly fixedStepSeconds: number;
  readonly dayLengthSeconds: number;

  #tick: number;

  constructor(options: GameTimeOptions) {
    const { fixedStepSeconds, dayLengthSeconds, startTick = 0 } = options;

    if (!Number.isFinite(fixedStepSeconds) || fixedStepSeconds <= 0) {
      throw new RangeError('fixedStepSeconds must be a finite positive number');
    }
    if (!Number.isFinite(dayLengthSeconds) || dayLengthSeconds <= 0) {
      throw new RangeError('dayLengthSeconds must be a finite positive number');
    }
    if (!Number.isInteger(startTick) || startTick < 0) {
      throw new RangeError('startTick must be a non-negative integer');
    }

    this.fixedStepSeconds = fixedStepSeconds;
    this.dayLengthSeconds = dayLengthSeconds;
    this.#tick = startTick;
  }

  get tick(): number {
    return this.#tick;
  }

  get elapsedSeconds(): number {
    return this.#tick * this.fixedStepSeconds;
  }

  get elapsedMinutes(): number {
    return this.elapsedSeconds / 60;
  }

  /** Zero-based number of full days elapsed. */
  get dayIndex(): number {
    return Math.floor(this.totalDays);
  }

  /** Continuous day value, e.g. 2.5 means noon of the third day. */
  get totalDays(): number {
    return this.elapsedSeconds / this.dayLengthSeconds;
  }

  /** Progress through the current day, in [0, 1). */
  get dayPhase(): number {
    return this.totalDays - Math.floor(this.totalDays);
  }

  /** In-game hour in [0, 24). */
  get hourOfDay(): number {
    return this.dayPhase * 24;
  }

  /** Advances the clock by one or more fixed ticks. */
  advanceStep(steps = 1): void {
    if (!Number.isInteger(steps) || steps < 0) {
      throw new RangeError('steps must be a non-negative integer');
    }
    this.#tick += steps;
  }
}
