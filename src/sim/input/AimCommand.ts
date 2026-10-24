/**
 * Aiming and firing as tick-stamped commands, mirroring drive input.
 *
 * `aimPoint` is a world-space position (not a screen coordinate), so the
 * simulation stays render-independent and deterministic.
 */

export interface AimPoint {
  readonly x: number;
  readonly y: number;
}

export interface AimControls {
  readonly aimPoint: AimPoint | null;
  readonly fire: boolean;
  /** Zero-based weapon slot. Out-of-range values are clamped by the weapon system. */
  readonly activeSlot: number;
  /** Monotonic request counter; a changed value triggers one reload attempt. */
  readonly reloadToken: number;
}

export interface AimCommand extends AimControls {
  readonly tick: number;
}

export const DEFAULT_AIM_CONTROLS: AimControls = Object.freeze({
  aimPoint: null,
  fire: false,
  activeSlot: 0,
  reloadToken: 0,
});

export function createAimControls(partial: Partial<AimControls> = {}): AimControls {
  const rawPoint = partial.aimPoint;
  const aimPoint =
    rawPoint && Number.isFinite(rawPoint.x) && Number.isFinite(rawPoint.y)
      ? { x: rawPoint.x, y: rawPoint.y }
      : null;

  const rawSlot = partial.activeSlot ?? 0;
  const activeSlot = Number.isInteger(rawSlot) && rawSlot >= 0 ? rawSlot : 0;

  const rawToken = partial.reloadToken ?? 0;
  const reloadToken = Number.isInteger(rawToken) && rawToken >= 0 ? rawToken : 0;

  return {
    aimPoint,
    fire: partial.fire ?? false,
    activeSlot,
    reloadToken,
  };
}

export function assertValidAimTick(tick: number): void {
  if (!Number.isInteger(tick) || tick < 0) {
    throw new RangeError('aim command.tick must be a non-negative integer');
  }
}

export function aimControlsEqual(
  a: AimControls,
  b: AimControls,
  epsilon = 0.002,
): boolean {
  if (
    a.fire !== b.fire ||
    a.activeSlot !== b.activeSlot ||
    a.reloadToken !== b.reloadToken
  ) {
    return false;
  }
  if (a.aimPoint === null || b.aimPoint === null) {
    return a.aimPoint === b.aimPoint;
  }
  return (
    Math.abs(a.aimPoint.x - b.aimPoint.x) <= epsilon &&
    Math.abs(a.aimPoint.y - b.aimPoint.y) <= epsilon
  );
}

export function controlsFromAimCommand(command: AimCommand): AimControls {
  return {
    aimPoint: command.aimPoint ? { ...command.aimPoint } : null,
    fire: command.fire,
    activeSlot: command.activeSlot,
    reloadToken: command.reloadToken,
  };
}
