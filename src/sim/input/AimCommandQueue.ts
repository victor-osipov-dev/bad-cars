import {
  assertValidAimTick,
  controlsFromAimCommand,
  createAimControls,
  DEFAULT_AIM_CONTROLS,
  type AimCommand,
  type AimControls,
} from './AimCommand';

const MAX_PENDING_AIM_COMMANDS = 240;

/**
 * Tick-ordered aim/fire buffer with the same latest-wins semantics as the
 * drive command queue.
 */
export class AimCommandQueue {
  #pending: AimCommand[] = [];
  #active: AimCommand;

  constructor(initialTick = 0, initialControls: AimControls = DEFAULT_AIM_CONTROLS) {
    assertValidAimTick(initialTick);
    this.#active = { ...initialControls, tick: initialTick };
  }

  get active(): AimCommand {
    return { ...this.#active };
  }

  get pendingCount(): number {
    return this.#pending.length;
  }

  enqueue(command: AimCommand): void {
    assertValidAimTick(command.tick);

    const normalized: AimCommand = {
      ...createAimControls(command),
      tick: command.tick,
    };

    if (normalized.tick <= this.#active.tick) {
      this.#active = normalized;
      return;
    }

    const existingIndex = this.#pending.findIndex((entry) => entry.tick === normalized.tick);
    if (existingIndex >= 0) {
      this.#pending[existingIndex] = normalized;
      return;
    }

    let insertAt = this.#pending.length;
    for (let index = 0; index < this.#pending.length; index += 1) {
      const entry = this.#pending[index];
      if (entry && entry.tick > normalized.tick) {
        insertAt = index;
        break;
      }
    }
    this.#pending.splice(insertAt, 0, normalized);

    if (this.#pending.length > MAX_PENDING_AIM_COMMANDS) {
      this.#pending.splice(0, this.#pending.length - MAX_PENDING_AIM_COMMANDS);
    }
  }

  advanceTo(tick: number): AimControls {
    assertValidAimTick(tick);

    while (this.#pending.length > 0) {
      const next = this.#pending[0];
      if (!next || next.tick > tick) break;
      this.#pending.shift();
      this.#active = next;
    }

    return controlsFromAimCommand(this.#active);
  }

  clear(): void {
    this.#pending = [];
  }
}
