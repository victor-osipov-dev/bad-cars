/** Independent reasons to pause the simulation, so one cannot cancel another. */
export type PauseReason = 'manual' | 'menu' | 'focus';

export class PauseReasons {
  readonly #reasons = new Set<PauseReason>();

  get active(): boolean {
    return this.#reasons.size > 0;
  }

  has(reason: PauseReason): boolean {
    return this.#reasons.has(reason);
  }

  /** Returns true when the effective paused state changed. */
  set(reason: PauseReason, active: boolean): boolean {
    const before = this.active;
    if (active) this.#reasons.add(reason);
    else this.#reasons.delete(reason);
    return before !== this.active;
  }

  toggle(reason: PauseReason): boolean {
    return this.set(reason, !this.has(reason));
  }

  clear(): void {
    this.#reasons.clear();
  }
}
