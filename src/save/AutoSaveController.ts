/**
 * Autosave policy.
 *
 * Pure and clock-free: it observes integer simulation signals and decides when
 * a save is due. Real time and IndexedDB stay in the app layer.
 */

export interface AutoSaveSignals {
  readonly tick: number;
  readonly baseCount: number;
  readonly structureCount: number;
  readonly capturedCount: number;
  readonly garageRevision: number;
}

export interface AutoSaveOptions {
  /** Save at least this often, in simulation ticks. Defaults to 2 minutes. */
  readonly intervalTicks?: number;
}

export class AutoSaveController {
  readonly intervalTicks: number;
  readonly #onSave: () => void | Promise<void>;
  #lastTick = 0;
  #signature = '';

  constructor(onSave: () => void | Promise<void>, options: AutoSaveOptions = {}) {
    this.#onSave = onSave;
    this.intervalTicks = options.intervalTicks ?? 60 * 120;
    if (!Number.isInteger(this.intervalTicks) || this.intervalTicks < 1) {
      throw new RangeError('intervalTicks must be a positive integer');
    }
  }

  /** Returns true when the caller should persist the current world. */
  observe(signals: AutoSaveSignals): boolean {
    const signature = [
      signals.baseCount,
      signals.structureCount,
      signals.capturedCount,
      signals.garageRevision,
    ].join(':');
    const significantChange = this.#signature !== '' && signature !== this.#signature;
    const intervalReached = signals.tick - this.#lastTick >= this.intervalTicks;
    if (!significantChange && !intervalReached) return false;

    this.#lastTick = signals.tick;
    this.#signature = signature;
    void this.#onSave();
    return true;
  }

  /** Rebases the policy after a load so the fresh world is not saved again. */
  reset(signals: AutoSaveSignals): void {
    this.#lastTick = signals.tick;
    this.#signature = [
      signals.baseCount,
      signals.structureCount,
      signals.capturedCount,
      signals.garageRevision,
    ].join(':');
  }
}
