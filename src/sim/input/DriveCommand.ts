/**
 * Player input as data, not direct mutation.
 *
 * Every command is stamped with the simulation tick it should take effect on.
 * This keeps the simulation deterministic and makes future network replay
 * straightforward: the same command stream always produces the same state.
 */

export interface DriveControls {
  /** -1 = full left turn, +1 = full right turn. */
  readonly steer: number;
  /** 0..1. The car has automatic throttle, so 1 is the default. */
  readonly throttle: number;
  /** 0..1 brake input. */
  readonly brake: number;
  /** 0..1 reverse gear input; drives the car backwards at full press. */
  readonly reverse: number;
  readonly handbrake: boolean;
  /**
   * Hold to interact with the world: harvest a nearby resource node, or
   * unload cargo when standing on the depot. Kept in the same tick-stamped
   * command as driving so both arrive in a deterministic order.
   */
  readonly interact: boolean;
  /**
   * Edge-triggered action counters. Input increments them on key-down; systems
   * compare against the last consumed value, so a held key acts exactly once
   * and the behaviour stays replayable.
   */
  readonly foundBaseToken: number;
  readonly buildToken: number;
  readonly cycleBaseToken: number;
}

type ActionTokenFields = 'foundBaseToken' | 'buildToken' | 'cycleBaseToken';

/**
 * A tick-stamped input command.
 *
 * Action tokens are optional here: a command that only touches driving may
 * omit them, and they default to 0. `createDriveControls` always produces the
 * complete, canonical control state the simulation consumes.
 */
export type DriveCommand = Omit<DriveControls, ActionTokenFields> &
  Partial<Pick<DriveControls, ActionTokenFields>> & {
    /** Simulation tick at which this command becomes effective. */
    readonly tick: number;
  };

/** The car always creeps forward unless told otherwise. */
export const AUTO_DRIVE_CONTROLS: DriveControls = Object.freeze({
  steer: 0,
  throttle: 1,
  brake: 0,
  reverse: 0,
  handbrake: false,
  interact: false,
  foundBaseToken: 0,
  buildToken: 0,
  cycleBaseToken: 0,
});

function clampToken(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Builds controls from partial input, clamping analog axes to valid ranges. */
export function createDriveControls(
  partial: Partial<DriveControls> = AUTO_DRIVE_CONTROLS,
): DriveControls {
  const steer = Number.isFinite(partial.steer) ? (partial.steer as number) : 0;
  return {
    steer: Math.min(1, Math.max(-1, steer)),
    throttle: clamp01(partial.throttle ?? AUTO_DRIVE_CONTROLS.throttle),
    brake: clamp01(partial.brake ?? AUTO_DRIVE_CONTROLS.brake),
    reverse: clamp01(partial.reverse ?? AUTO_DRIVE_CONTROLS.reverse),
    handbrake: partial.handbrake ?? AUTO_DRIVE_CONTROLS.handbrake,
    interact: partial.interact ?? AUTO_DRIVE_CONTROLS.interact,
    foundBaseToken: clampToken(partial.foundBaseToken),
    buildToken: clampToken(partial.buildToken),
    cycleBaseToken: clampToken(partial.cycleBaseToken),
  };
}

export function assertValidCommandTick(tick: number): void {
  if (!Number.isInteger(tick) || tick < 0) {
    throw new RangeError('command.tick must be a non-negative integer');
  }
}

export function controlsFromCommand(command: DriveCommand): DriveControls {
  return {
    steer: command.steer,
    throttle: command.throttle,
    brake: command.brake,
    reverse: command.reverse,
    handbrake: command.handbrake,
    interact: command.interact,
    foundBaseToken: command.foundBaseToken ?? 0,
    buildToken: command.buildToken ?? 0,
    cycleBaseToken: command.cycleBaseToken ?? 0,
  };
}
