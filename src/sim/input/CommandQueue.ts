import {
  AUTO_DRIVE_CONTROLS,
  assertValidCommandTick,
  controlsFromCommand,
  createDriveControls,
  type DriveCommand,
  type DriveControls,
} from './DriveCommand';

/** Hard cap on buffered future commands; old entries are dropped first. */
const MAX_PENDING_COMMANDS = 240;

/**
 * Tick-ordered command buffer.
 *
 * Commands are applied in tick order and remain active until a newer one
 * arrives. Late commands (tick <= the active command) replace the active state
 * instead of rewinding the queue.
 */
export class CommandQueue {
  #pending: DriveCommand[] = [];
  #active: DriveCommand;

  constructor(initialTick = 0, initialControls: DriveControls = AUTO_DRIVE_CONTROLS) {
    assertValidCommandTick(initialTick);
    this.#active = { ...initialControls, tick: initialTick };
  }

  get active(): DriveCommand {
    return { ...this.#active };
  }

  get pendingCount(): number {
    return this.#pending.length;
  }

  /** Queues a command; replaces an existing command for the same tick. */
  enqueue(command: DriveCommand): void {
    assertValidCommandTick(command.tick);

    const normalized: DriveCommand = {
      ...createDriveControls(command),
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

    if (this.#pending.length > MAX_PENDING_COMMANDS) {
      this.#pending.splice(0, this.#pending.length - MAX_PENDING_COMMANDS);
    }
  }

  /** Consumes all commands due by `tick` and returns the effective controls. */
  advanceTo(tick: number): DriveControls {
    assertValidCommandTick(tick);

    while (this.#pending.length > 0) {
      const next = this.#pending[0];
      if (!next || next.tick > tick) break;
      this.#pending.shift();
      this.#active = next;
    }

    return controlsFromCommand(this.#active);
  }

  clear(): void {
    this.#pending = [];
  }
}
